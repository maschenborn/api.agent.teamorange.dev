import Docker from 'dockerode';
import type { AgentTask, AgentResult } from './types.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { AgentExecutionError } from '../utils/errors.js';
import { getAgentForEmail, type AgentConfig } from '../agents/registry.js';
import { getSessionPaths, hasClaudeSession, type SessionPaths } from '../session/index.js';

const docker = new Docker();

export async function executeAgentTask(task: AgentTask): Promise<AgentResult> {
  // Get agent configuration based on recipient email
  const agentConfig = getAgentForEmail(task.recipient);

  logger.info(
    { taskId: task.id, agentId: agentConfig.id, recipient: task.recipient, sessionId: task.sessionId },
    `Using agent: ${agentConfig.name}`
  );

  const containerName = `claude-agent-${agentConfig.id}-${task.id.substring(0, 8)}`;

  // Get session paths if session ID is provided
  let sessionPaths: SessionPaths | null = null;
  let useResume = false;

  if (task.sessionId) {
    sessionPaths = getSessionPaths(agentConfig.id, task.sessionId);
    useResume = await hasClaudeSession(agentConfig.id, task.sessionId);
    logger.info(
      { taskId: task.id, sessionId: task.sessionId, useResume, sessionPaths: sessionPaths.root },
      'Using persistent session'
    );
  }

  logger.info({ taskId: task.id, containerName, agentId: agentConfig.id }, 'Starting agent container');

  // Build the prompt for this specific agent
  const agentPrompt = buildAgentPrompt(task, agentConfig);

  try {
    // Build environment variables
    const envVars = buildEnvVars(task, agentConfig, agentPrompt, useResume);

    // Build bind mounts
    const binds = buildBindMounts(sessionPaths);

    // Create container
    const container = await docker.createContainer({
      Image: config.agentDockerImage,
      name: containerName,
      Env: envVars,
      HostConfig: {
        // Memory limit: 2GB
        Memory: 2 * 1024 * 1024 * 1024,
        // CPU limit: 2 cores
        NanoCpus: 2_000_000_000,
        // Don't auto-remove - we need to get logs first
        AutoRemove: false,
        // Network for API access
        NetworkMode: 'bridge',
        // Mount session directories or fallback to old behavior
        Binds: binds,
      },
      WorkingDir: '/workspace',
    });

    logger.info({ containerName }, 'Container created, starting...');

    // Start container
    await container.start();

    // Wait for container with timeout
    const waitPromise = container.wait();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Agent timeout exceeded')), config.agentTimeoutMs);
    });

    const result = await Promise.race([waitPromise, timeoutPromise]);

    // Get logs
    const logsBuffer = await container.logs({
      stdout: true,
      stderr: true,
      follow: false,
    });

    const output = logsBuffer.toString('utf8');

    logger.info({ containerName, exitCode: result.StatusCode }, 'Agent container finished');

    // Clean up container after getting logs
    try {
      await container.remove({ force: true });
      logger.debug({ containerName }, 'Container removed');
    } catch (removeError) {
      logger.warn({ removeError, containerName }, 'Failed to remove container');
    }

    if (result.StatusCode !== 0) {
      return {
        success: false,
        summary: 'Agent exited with error',
        filesModified: [],
        error: output.slice(-2000),
      };
    }

    return parseAgentOutput(output, agentConfig);
  } catch (error) {
    logger.error({ error, containerName, taskId: task.id }, 'Agent execution failed');

    // Try to clean up container
    try {
      const container = docker.getContainer(containerName);
      await container.stop({ t: 5 }).catch(() => {});
      await container.remove({ force: true }).catch(() => {});
    } catch {
      // Container might already be removed
    }

    throw new AgentExecutionError(error instanceof Error ? error.message : 'Unknown agent error', task.id);
  }
}

function buildAgentPrompt(task: AgentTask, agentConfig: AgentConfig): string {
  return `
${agentConfig.systemPrompt}

## Aktuelle Anfrage
Von: ${task.sender}
Betreff: ${task.subject}

${task.description}

## Ausgabe
Gib deine Antwort als reinen Text aus. Diese wird per E-Mail an den Absender gesendet.
`.trim();
}

/**
 * Build bind mounts for the container
 * With sessions: mount workspace and claude-home
 * Without sessions: mount credentials read-only (legacy behavior)
 */
function buildBindMounts(sessionPaths: SessionPaths | null): string[] {
  if (sessionPaths) {
    // Session mode: mount persistent directories
    // Use sessionsHostPath for Docker-in-Docker: this is the HOST path that Docker daemon can access
    const hostRoot = sessionPaths.root.replace(config.sessionsPath, config.sessionsHostPath);

    return [
      // Workspace (read-write) - persistent across session
      `${hostRoot}/workspace:/workspace`,
      // Claude home (read-write) - contains sessions, settings, etc.
      `${hostRoot}/claude-home:/home/agent/.claude`,
      // Credentials from host (read-only) - for authentication
      `${config.claudeHostPath}:/host-claude:ro`,
    ];
  }

  // Legacy mode: just mount credentials
  return [`${config.claudeHostPath}:/host-claude:ro`];
}

function buildEnvVars(task: AgentTask, agentConfig: AgentConfig, prompt: string, useResume: boolean): string[] {
  const envVars: string[] = [
    `AGENT_PROMPT=${prompt}`,
    `MAX_TURNS=${config.maxAgentTurns}`,
    `AGENT_ID=${agentConfig.id}`,
    `TASK_ID=${task.id}`,
  ];

  // Session management
  if (task.sessionId) {
    envVars.push(`SESSION_ID=${task.sessionId}`);
    // Tell entrypoint to skip credential copy (already in mounted claude-home)
    envVars.push(`SKIP_CREDENTIAL_SETUP=true`);
  }

  if (useResume) {
    // Tell entrypoint to use --resume
    envVars.push(`USE_RESUME=true`);
  }

  // Add Git credentials only if configured (for git-based agents)
  if (config.githubToken) {
    envVars.push(`GITHUB_TOKEN=${config.githubToken}`);
  }

  if (config.gitEmail) {
    envVars.push(`GIT_EMAIL=${config.gitEmail}`);
  }

  if (config.gitName) {
    envVars.push(`GIT_NAME=${config.gitName}`);
  }

  // Add repo URL if configured
  if (config.demoprojektRepoUrl) {
    envVars.push(`REPO_URL=${config.demoprojektRepoUrl}`);
  }

  // Add agent-specific environment variables
  if (agentConfig.env) {
    for (const [key, value] of Object.entries(agentConfig.env)) {
      envVars.push(`${key}=${value}`);
    }
  }

  return envVars;
}

/**
 * Strip Docker multiplexed stream headers from output.
 * Docker logs contain 8-byte headers: [stream_type, 0, 0, 0, size (4 bytes)]
 * These appear as non-printable characters at the start of lines.
 */
function stripDockerStreamHeaders(output: string): string {
  // Remove Docker stream header bytes (non-printable chars at line starts)
  // The header is 8 bytes: type (1) + padding (3) + size (4)
  return output
    .split('\n')
    .map((line) => {
      // Strip leading non-printable characters and control codes
      return line.replace(/^[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, '');
    })
    .join('\n');
}

interface ClaudeResponseData {
  text: string;
  modelsUsed: string[];
}

/**
 * Extract Claude's response text and model usage from JSON output.
 * Claude Code with --output-format json returns:
 * { "type": "result", "subtype": "success", "result": "response text...", "modelUsage": {...} }
 */
function extractClaudeResponse(output: string): ClaudeResponseData | null {
  // Clean Docker headers first
  const cleanOutput = stripDockerStreamHeaders(output);

  // Try to find and parse JSON output from Claude
  // Look for the result JSON object with type "result"
  const jsonMatch = cleanOutput.match(/\{"type":"result"[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    // Extract model names from modelUsage (e.g. "claude-haiku-4-5-20251001" -> "Haiku 4.5")
    const modelsUsed: string[] = [];
    if (parsed.modelUsage && typeof parsed.modelUsage === 'object') {
      for (const modelId of Object.keys(parsed.modelUsage)) {
        const friendlyName = formatModelName(modelId);
        if (friendlyName && !modelsUsed.includes(friendlyName)) {
          modelsUsed.push(friendlyName);
        }
      }
    }

    // The actual format: { "type": "result", "result": "text..." }
    if (parsed.type === 'result' && typeof parsed.result === 'string') {
      return { text: parsed.result, modelsUsed };
    }

    // Fallback: check for content array format (older versions)
    if (parsed.result?.content && Array.isArray(parsed.result.content)) {
      const textParts = parsed.result.content
        .filter((item: { type: string; text?: string }) => item.type === 'text' && item.text)
        .map((item: { text: string }) => item.text);
      return { text: textParts.join('\n'), modelsUsed };
    }

    return null;
  } catch {
    logger.warn({ output: jsonMatch[0].slice(0, 500) }, 'Failed to parse Claude JSON output');
    return null;
  }
}

/**
 * Convert model ID to friendly name.
 * e.g. "claude-haiku-4-5-20251001" -> "Haiku 4.5"
 */
function formatModelName(modelId: string): string {
  if (modelId.includes('opus')) return 'Opus 4.5';
  if (modelId.includes('sonnet')) return 'Sonnet 4';
  if (modelId.includes('haiku')) return 'Haiku 4.5';
  return modelId;
}

function parseAgentOutput(output: string, agentConfig: AgentConfig): AgentResult {
  // Try to extract Claude's response from JSON output
  const claudeResponse = extractClaudeResponse(output);

  if (claudeResponse) {
    // Successfully parsed JSON output - use Claude's response directly
    logger.info(
      { responseLength: claudeResponse.text.length, modelsUsed: claudeResponse.modelsUsed },
      'Extracted Claude response from JSON'
    );

    return {
      success: true,
      summary: claudeResponse.text.slice(0, 3000),
      filesModified: [],
      output: output.slice(-5000),
      modelsUsed: claudeResponse.modelsUsed.length > 0 ? claudeResponse.modelsUsed : undefined,
    };
  }

  // Fallback: parse raw output (for backwards compatibility or errors)
  logger.warn('Could not parse JSON output, falling back to raw parsing');

  const cleanOutput = stripDockerStreamHeaders(output);
  const lines = cleanOutput.split('\n').filter((line) => line.trim());

  // Filter out system/debug lines
  const responseLines = lines.filter((line) => {
    return (
      !line.startsWith('[') &&
      !line.includes('→') &&
      !line.includes('Enumerating') &&
      !line.includes('Compressing') &&
      !line.includes('Writing objects') &&
      !line.includes('remote:') &&
      !line.includes('To https://') &&
      !line.includes('branch') &&
      !line.match(/^[a-f0-9]+\.\.[a-f0-9]+/) &&
      !line.includes('Setting up Claude Code credentials') &&
      !line.includes('Credentials copied') &&
      !line.includes('Task:')
    );
  });

  // Look for commit hash in output (for git-based agents)
  const commitMatch = output.match(/\[main ([a-f0-9]{7,40})\]/);
  const commitHash = commitMatch?.[1];

  // Look for modified files
  const filesModified: string[] = [];
  const fileMatches = output.matchAll(/(?:create|modify|delete) mode \d+ (.+)/g);
  for (const match of fileMatches) {
    filesModified.push(match[1]);
  }

  const summary = responseLines.join('\n').slice(-3000) || 'Aufgabe abgeschlossen';

  return {
    success: true,
    summary,
    filesModified,
    commitHash,
    output: output.slice(-5000),
  };
}
