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

function parseAgentOutput(output: string, agentConfig: AgentConfig): AgentResult {
  // Try to extract structured information from the output
  const lines = output.split('\n').filter((line) => line.trim());

  // For simple agents (like test), just return the output as summary
  // Filter out system/debug lines
  const responseLines = lines.filter((line) => {
    // Skip git and system output
    return (
      !line.startsWith('[') &&
      !line.includes('→') &&
      !line.includes('Enumerating') &&
      !line.includes('Compressing') &&
      !line.includes('Writing objects') &&
      !line.includes('remote:') &&
      !line.includes('To https://') &&
      !line.includes('branch') &&
      !line.match(/^[a-f0-9]+\.\.[a-f0-9]+/)
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

  // Use the filtered response as summary
  const summary = responseLines.join('\n').slice(-3000) || 'Aufgabe abgeschlossen';

  return {
    success: true,
    summary,
    filesModified,
    commitHash,
    output: output.slice(-5000),
  };
}
