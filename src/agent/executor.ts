import Docker from 'dockerode';
import type { AgentTask, AgentResult } from './types.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { AgentExecutionError } from '../utils/errors.js';
import { getAgentForEmail, type AgentConfig } from '../agents/registry.js';

const docker = new Docker();

export async function executeAgentTask(task: AgentTask): Promise<AgentResult> {
  // Get agent configuration based on recipient email
  const agentConfig = getAgentForEmail(task.recipient);

  logger.info(
    { taskId: task.id, agentId: agentConfig.id, recipient: task.recipient },
    `Using agent: ${agentConfig.name}`
  );

  const containerName = `claude-agent-${agentConfig.id}-${task.id.substring(0, 8)}`;

  logger.info({ taskId: task.id, containerName, agentId: agentConfig.id }, 'Starting agent container');

  // Build the prompt for this specific agent
  const agentPrompt = buildAgentPrompt(task, agentConfig);

  try {
    // Build environment variables
    const envVars = buildEnvVars(task, agentConfig, agentPrompt);

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
        // Mount Claude session credentials (read-only, will be copied by entrypoint)
        // Use claudeHostPath for Docker-in-Docker: this is the HOST path that Docker daemon can access
        Binds: [`${config.claudeHostPath}:/host-claude:ro`],
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

function buildEnvVars(task: AgentTask, agentConfig: AgentConfig, prompt: string): string[] {
  const envVars: string[] = [
    `AGENT_PROMPT=${prompt}`,
    `MAX_TURNS=${config.maxAgentTurns}`,
    `AGENT_ID=${agentConfig.id}`,
    `TASK_ID=${task.id}`,
  ];

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

/**
 * Extract Claude's response text from JSON output.
 * Claude Code with --output-format json returns:
 * { "result": { "content": [{ "type": "text", "text": "..." }] } }
 */
function extractClaudeResponse(output: string): string | null {
  // Clean Docker headers first
  const cleanOutput = stripDockerStreamHeaders(output);

  // Try to find and parse JSON output from Claude
  // The JSON may be preceded by setup messages, so look for the JSON object
  const jsonMatch = cleanOutput.match(/\{[\s\S]*"result"[\s\S]*"content"[\s\S]*\}/);
  if (!jsonMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    // Extract text from result.content array
    if (parsed.result?.content && Array.isArray(parsed.result.content)) {
      const textParts = parsed.result.content
        .filter((item: { type: string; text?: string }) => item.type === 'text' && item.text)
        .map((item: { text: string }) => item.text);
      return textParts.join('\n');
    }

    return null;
  } catch {
    logger.warn({ output: jsonMatch[0].slice(0, 500) }, 'Failed to parse Claude JSON output');
    return null;
  }
}

function parseAgentOutput(output: string, agentConfig: AgentConfig): AgentResult {
  // Try to extract Claude's response from JSON output
  const claudeResponse = extractClaudeResponse(output);

  if (claudeResponse) {
    // Successfully parsed JSON output - use Claude's response directly
    logger.info({ responseLength: claudeResponse.length }, 'Extracted Claude response from JSON');

    return {
      success: true,
      summary: claudeResponse.slice(0, 3000),
      filesModified: [],
      output: output.slice(-5000),
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
