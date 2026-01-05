import Docker from 'dockerode';
import type { AgentTask, AgentResult } from './types.js';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { AgentExecutionError } from '../utils/errors.js';

const docker = new Docker();

export async function executeAgentTask(task: AgentTask): Promise<AgentResult> {
  // Check required config for agent execution
  if (!config.githubToken || !config.demoprojektRepoUrl) {
    logger.warn({ taskId: task.id }, 'Agent execution skipped - GITHUB_TOKEN or DEMOPROJEKT_REPO_URL not configured');
    return {
      success: false,
      summary: 'Agent-Ausführung nicht konfiguriert. GITHUB_TOKEN und DEMOPROJEKT_REPO_URL müssen gesetzt sein.',
      filesModified: [],
      error: 'Missing required configuration: GITHUB_TOKEN and/or DEMOPROJEKT_REPO_URL',
    };
  }

  const containerName = `claude-agent-${task.id.substring(0, 8)}`;

  logger.info({ taskId: task.id, containerName }, 'Starting agent container');

  const agentPrompt = buildAgentPrompt(task);

  try {
    // Create container
    const container = await docker.createContainer({
      Image: config.agentDockerImage,
      name: containerName,
      Env: [
        `GITHUB_TOKEN=${config.githubToken}`,
        `GIT_EMAIL=${config.gitEmail}`,
        `GIT_NAME=${config.gitName}`,
        `AGENT_PROMPT=${agentPrompt}`,
        `MAX_TURNS=${config.maxAgentTurns}`,
        `REPO_URL=${config.demoprojektRepoUrl}`,
      ],
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
        Binds: [
          `${config.claudeSessionPath}:/host-claude:ro`,
        ],
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

    logger.info(
      { containerName, exitCode: result.StatusCode },
      'Agent container finished'
    );

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

    return parseAgentOutput(output);
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

    throw new AgentExecutionError(
      error instanceof Error ? error.message : 'Unknown agent error',
      task.id
    );
  }
}

function buildAgentPrompt(task: AgentTask): string {
  return `
Du bist ein autonomer Coding-Agent, der an dem Demoprojekt arbeitet.

## Deine Aufgabe
${task.description}

## Anweisungen
1. Klone das Repository: git clone $REPO_URL .
2. Führe die angeforderten Änderungen durch
3. Teste deine Änderungen (bun run build)
4. Committe die Änderungen mit einer aussagekräftigen Nachricht
5. Pushe die Änderungen auf den main Branch

## Wichtig
- Arbeite nur im /workspace Verzeichnis
- Keine externen Abhängigkeiten hinzufügen ohne explizite Anfrage
- Verwende die Brand-Farbe #fa5f46 für Akzente
- Alle Inhalte auf Deutsch
- Am Ende: Gib eine kurze Zusammenfassung aus, was du getan hast

## Los geht's
`.trim();
}

function parseAgentOutput(output: string): AgentResult {
  // Try to extract structured information from the output
  const lines = output.split('\n').filter((line) => line.trim());

  // Look for commit hash in output
  const commitMatch = output.match(/\[main ([a-f0-9]{7,40})\]/);
  const commitHash = commitMatch?.[1];

  // Look for modified files
  const filesModified: string[] = [];
  const fileMatches = output.matchAll(/(?:create|modify|delete) mode \d+ (.+)/g);
  for (const match of fileMatches) {
    filesModified.push(match[1]);
  }

  // Extract last meaningful output as summary
  const summaryLines = lines.slice(-10).filter((line) => {
    // Skip git and system output
    return (
      !line.startsWith('[') &&
      !line.includes('→') &&
      !line.includes('Enumerating') &&
      !line.includes('Compressing') &&
      !line.includes('Writing objects')
    );
  });

  const summary = summaryLines.join('\n').slice(0, 1000) || 'Aufgabe abgeschlossen';

  return {
    success: true,
    summary,
    filesModified,
    commitHash,
    output: output.slice(-5000),
  };
}
