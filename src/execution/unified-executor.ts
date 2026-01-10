/**
 * Unified Executor
 *
 * Central execution logic for all channels (API, Email, Teams).
 * Uses Claude Agent SDK in Docker containers for task execution.
 *
 * Architecture:
 * - SDK Image: docker/sdk/ - TypeScript-based with @anthropic-ai/claude-agent-sdk
 * - Legacy Image: docker/Dockerfile - Shell-based (deprecated)
 */

import Docker from 'dockerode';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { AgentExecutionError } from '../utils/errors.js';
import { getSessionPaths, type SessionPaths } from '../session/index.js';
import { injectMcpConfig, injectMcpConfigDirect, type McpJsonFormat } from './mcp-injector.js';
import type { McpConfig } from '../agents/registry.js';
import type { ExecutionRequest, ExecutionResult, ExecutionStatus } from './types.js';

// SDK Task Config (passed to container via AGENT_TASK env var)
interface SdkTaskConfig {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTurns?: number;
  sessionId?: string;
  allowedTools?: string[];
  agentId?: string;
}

// SDK Result (returned from container on stdout)
interface SdkTaskResult {
  success: boolean;
  sessionId: string;
  output: string;
  structuredOutput?: unknown;
  cost?: number;
  turns?: number;
  error?: string;
}

const docker = new Docker();

// In-memory execution tracking
const runningExecutions = new Map<string, ExecutionStatus>();

/**
 * Execute a task in a Docker container
 */
export async function executeTask(request: ExecutionRequest): Promise<ExecutionResult> {
  const { executionId, agentConfig, sessionId } = request;
  const containerName = `claude-agent-${agentConfig.id}-${executionId.substring(0, 8)}`;

  // Track execution
  const status: ExecutionStatus = {
    executionId,
    status: 'running',
    agentId: agentConfig.id,
    sessionId,
    prompt: request.prompt.slice(0, 200),
    source: request.source,
    sender: request.sender,
    startedAt: new Date(),
  };
  runningExecutions.set(executionId, status);

  logger.info(
    {
      executionId,
      agentId: agentConfig.id,
      sessionId,
      useResume: request.useResume,
      source: request.source,
    },
    'Starting execution'
  );

  // Get session paths if session mode
  let sessionPaths: SessionPaths | null = null;
  if (sessionId) {
    sessionPaths = getSessionPaths(agentConfig.id, sessionId);
    logger.debug({ sessionPaths: sessionPaths.root }, 'Using session paths');
  }

  // Inject MCP config: request.mcpConfig (preset) or agent's mcpConfig (from .mcp.json)
  if (sessionPaths) {
    if (request.mcpConfig) {
      // Preset-based MCP config from request
      await injectMcpConfig(sessionPaths, request.mcpConfig);
      logger.info({ preset: request.mcpConfig.preset }, 'MCP config injected (preset)');
    } else if (agentConfig.mcpConfig) {
      // Agent-defined MCP config from .mcp.json
      const resolvedMcpConfig = resolveEnvPlaceholders(agentConfig.mcpConfig);
      await injectMcpConfigDirect(sessionPaths, resolvedMcpConfig);
      logger.info(
        { servers: Object.keys(agentConfig.mcpConfig.mcpServers || {}) },
        'MCP config injected (agent)'
      );
    }
  }

  // Build SDK task config
  const taskConfig = buildSdkTaskConfig(request);

  try {
    // Build environment variables for SDK container
    const envVars = buildSdkEnvVars(request, taskConfig);

    // Build bind mounts
    const binds = buildBindMounts(sessionPaths);

    // Use configured image (SDK is default)
    const dockerImage = config.agentDockerImage;

    // Create container with configurable resources
    const container = await docker.createContainer({
      Image: dockerImage,
      name: containerName,
      Env: envVars,
      HostConfig: {
        Memory: request.resources.memoryMb * 1024 * 1024,
        NanoCpus: request.resources.cpuCores * 1_000_000_000,
        AutoRemove: false,
        NetworkMode: 'bridge',
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
      setTimeout(
        () => reject(new Error('Agent timeout exceeded')),
        request.resources.timeoutMs
      );
    });

    const waitResult = await Promise.race([waitPromise, timeoutPromise]);

    // Get logs
    const logsBuffer = await container.logs({
      stdout: true,
      stderr: true,
      follow: false,
    });

    const output = logsBuffer.toString('utf8');

    logger.info({ containerName, exitCode: waitResult.StatusCode }, 'Container finished');

    // Clean up container
    try {
      await container.remove({ force: true });
      logger.debug({ containerName }, 'Container removed');
    } catch (removeError) {
      logger.warn({ removeError, containerName }, 'Failed to remove container');
    }

    // Parse result based on image type
    let result: ExecutionResult;
    if (waitResult.StatusCode !== 0) {
      result = {
        success: false,
        summary: 'Agent exited with error',
        filesModified: [],
        error: output.slice(-2000),
        rawOutput: output.slice(-5000),
      };
    } else {
      // Use SDK parser for SDK image, legacy parser for sandbox image
      const isLegacyImage = dockerImage.includes('sandbox');
      result = isLegacyImage ? parseAgentOutput(output) : parseSdkOutput(output);
    }

    // Update status
    status.status = result.success ? 'completed' : 'failed';
    status.completedAt = new Date();
    status.result = result;

    return result;
  } catch (error) {
    logger.error({ error, containerName, executionId }, 'Execution failed');

    // Try to clean up container
    try {
      const container = docker.getContainer(containerName);
      await container.stop({ t: 5 }).catch(() => {});
      await container.remove({ force: true }).catch(() => {});
    } catch {
      // Container might already be removed
    }

    // Update status
    status.status = 'failed';
    status.completedAt = new Date();
    status.result = {
      success: false,
      summary: 'Execution failed',
      filesModified: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };

    throw new AgentExecutionError(
      error instanceof Error ? error.message : 'Unknown agent error',
      executionId
    );
  } finally {
    // Keep in running map for a while for status queries, then remove
    setTimeout(() => {
      runningExecutions.delete(executionId);
    }, 5 * 60 * 1000); // 5 minutes
  }
}

/**
 * Get execution status by ID
 */
export function getExecutionStatus(executionId: string): ExecutionStatus | undefined {
  return runningExecutions.get(executionId);
}

/**
 * List all executions (running and recently completed)
 */
export function listExecutions(): ExecutionStatus[] {
  return Array.from(runningExecutions.values());
}

/**
 * Build the prompt for the agent
 */
function buildAgentPrompt(request: ExecutionRequest): string {
  const rawSystemPrompt = request.systemPrompt || request.agentConfig.systemPrompt;

  // Resolve {{VAR}} placeholders with values from process.env
  const systemPrompt = resolvePromptPlaceholders(rawSystemPrompt);

  return `
${systemPrompt}

## Aktuelle Anfrage
${request.sender ? `Von: ${request.sender}` : ''}
${request.subject ? `Betreff: ${request.subject}` : ''}

${request.prompt}

## Ausgabe
Gib deine Antwort als reinen Text aus.
`.trim();
}

/**
 * Build bind mounts for the container
 */
function buildBindMounts(sessionPaths: SessionPaths | null): string[] {
  if (sessionPaths) {
    // Session mode: mount persistent directories
    const hostRoot = sessionPaths.root.replace(config.sessionsPath, config.sessionsHostPath);

    return [
      `${hostRoot}/workspace:/workspace`,
      `${hostRoot}/claude-home:/home/agent/.claude`,
      `${config.claudeHostPath}:/host-claude:ro`,
    ];
  }

  // Legacy mode: just mount credentials
  return [`${config.claudeHostPath}:/host-claude:ro`];
}

/**
 * Build environment variables for the container
 */
function buildEnvVars(request: ExecutionRequest, prompt: string): string[] {
  const envVars: string[] = [
    `AGENT_PROMPT=${prompt}`,
    `MAX_TURNS=${request.resources.maxTurns}`,
    `AGENT_ID=${request.agentConfig.id}`,
    `EXECUTION_ID=${request.executionId}`,
    `AGENT_MODEL=${config.agentDefaultModel}`, // Default: opus
  ];

  // Session management
  if (request.sessionId) {
    envVars.push(`SESSION_ID=${request.sessionId}`);
    envVars.push(`SKIP_CREDENTIAL_SETUP=true`);
  }

  if (request.useResume) {
    envVars.push(`USE_RESUME=true`);
  }

  // Git credentials
  if (config.githubToken) {
    envVars.push(`GITHUB_TOKEN=${config.githubToken}`);
  }
  if (config.gitEmail) {
    envVars.push(`GIT_EMAIL=${config.gitEmail}`);
  }
  if (config.gitName) {
    envVars.push(`GIT_NAME=${config.gitName}`);
  }

  // Git repo from request or config
  const repoUrl = request.git?.repoUrl || config.demoprojektRepoUrl;
  if (repoUrl) {
    envVars.push(`REPO_URL=${repoUrl}`);
  }

  // Agent-specific env vars (resolve ${VAR} placeholders)
  if (request.agentConfig.env) {
    for (const [key, value] of Object.entries(request.agentConfig.env)) {
      const resolvedValue = resolveEnvValue(value);
      if (resolvedValue) {
        envVars.push(`${key}=${resolvedValue}`);
      }
    }
  }

  // MCP API keys (if using presets)
  if (request.mcpConfig?.preset?.includes('moco') && config.mocoApiKey) {
    envVars.push(`MOCO_API_KEY=${config.mocoApiKey}`);
  }
  if (request.mcpConfig?.preset?.includes('firecrawl') && config.firecrawlApiKey) {
    envVars.push(`FIRECRAWL_API_KEY=${config.firecrawlApiKey}`);
  }

  // Anthropic API Key (fallback if OAuth expires)
  if (config.anthropicApiKey) {
    envVars.push(`ANTHROPIC_API_KEY=${config.anthropicApiKey}`);
  }

  return envVars;
}

/**
 * Strip Docker multiplexed stream headers from output
 */
function stripDockerStreamHeaders(output: string): string {
  return output
    .split('\n')
    .map((line) => line.replace(/^[\x00-\x08\x0B\x0C\x0E-\x1F]+/g, ''))
    .join('\n');
}

/**
 * Extract auth method from container output
 */
function extractAuthMethod(output: string): 'oauth' | 'api_key' | undefined {
  const authMatch = output.match(/\[AUTH_METHOD:(oauth|api_key)\]/);
  return authMatch ? (authMatch[1] as 'oauth' | 'api_key') : undefined;
}

/**
 * Parse Claude's JSON output
 */
function parseAgentOutput(output: string): ExecutionResult {
  const cleanOutput = stripDockerStreamHeaders(output);

  // Extract auth method
  const authMethod = extractAuthMethod(output);

  // Try to find JSON result
  const jsonMatch = cleanOutput.match(/\{"type":"result"[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);

      // Extract model names
      const modelsUsed: string[] = [];
      if (parsed.modelUsage && typeof parsed.modelUsage === 'object') {
        for (const modelId of Object.keys(parsed.modelUsage)) {
          const friendlyName = formatModelName(modelId);
          if (friendlyName && !modelsUsed.includes(friendlyName)) {
            modelsUsed.push(friendlyName);
          }
        }
      }

      if (parsed.type === 'result' && typeof parsed.result === 'string') {
        // Look for commit hash and files
        const commitMatch = output.match(/\[main ([a-f0-9]{7,40})\]/);
        const filesModified: string[] = [];
        const fileMatches = output.matchAll(/(?:create|modify|delete) mode \d+ (.+)/g);
        for (const match of fileMatches) {
          filesModified.push(match[1]);
        }

        return {
          success: true,
          summary: parsed.result.slice(0, 3000),
          filesModified,
          commitHash: commitMatch?.[1],
          modelsUsed: modelsUsed.length > 0 ? modelsUsed : undefined,
          authMethod,
          rawOutput: output.slice(-5000),
        };
      }
    } catch {
      logger.warn('Failed to parse Claude JSON output');
    }
  }

  // Fallback: raw output parsing
  const lines = cleanOutput.split('\n').filter((line) => line.trim());
  const responseLines = lines.filter((line) => {
    return (
      !line.startsWith('[') &&
      !line.includes('→') &&
      !line.includes('Setting up Claude') &&
      !line.includes('Credentials copied')
    );
  });

  return {
    success: true,
    summary: responseLines.join('\n').slice(-3000) || 'Aufgabe abgeschlossen',
    filesModified: [],
    authMethod,
    rawOutput: output.slice(-5000),
  };
}

/**
 * Convert model ID to friendly name
 */
function formatModelName(modelId: string): string {
  if (modelId.includes('opus')) return 'Opus 4.5';
  if (modelId.includes('sonnet')) return 'Sonnet 4';
  if (modelId.includes('haiku')) return 'Haiku 4.5';
  return modelId;
}

/**
 * Resolve ${VAR} placeholders in MCP config from process.env
 *
 * Example: "${FIRECRAWL_API_KEY}" → actual value from process.env
 */
function resolveEnvPlaceholders(mcpConfig: McpConfig): McpJsonFormat {
  const resolved: McpJsonFormat = { mcpServers: {} };

  for (const [serverName, serverConfig] of Object.entries(mcpConfig.mcpServers || {})) {
    resolved.mcpServers[serverName] = {
      command: serverConfig.command,
      args: serverConfig.args,
      env: serverConfig.env ? resolveEnvObject(serverConfig.env) : undefined,
    };
  }

  return resolved;
}

/**
 * Resolve ${VAR} placeholders in an env object
 */
function resolveEnvObject(env: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    resolved[key] = resolveEnvValue(value);
  }

  return resolved;
}

/**
 * Resolve a single ${VAR} placeholder
 */
function resolveEnvValue(value: string): string {
  // Match ${VAR_NAME} pattern
  const match = value.match(/^\$\{(\w+)\}$/);
  if (match) {
    const envVar = match[1];
    const envValue = process.env[envVar];
    if (!envValue) {
      logger.warn({ envVar }, 'Environment variable not set, using empty string');
      return '';
    }
    return envValue;
  }

  // No placeholder, return as-is
  return value;
}

/**
 * Resolve {{VAR}} placeholders in prompt text with values from process.env
 *
 * Example: "Token: {{MOCO_API_KEY}}" → "Token: gk_xxx..."
 */
function resolvePromptPlaceholders(prompt: string): string {
  let replacementCount = 0;

  const resolved = prompt.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
    const value = process.env[varName];
    if (!value) {
      logger.warn({ varName }, 'Prompt placeholder not found in environment');
      return match; // Keep original if not found
    }
    replacementCount++;
    logger.debug({ varName, valueLength: value.length }, 'Replaced prompt placeholder');
    return value;
  });

  logger.info({ replacementCount }, 'Prompt placeholders resolved');
  return resolved;
}

// ============================================
// SDK-specific functions
// ============================================

/**
 * Build SDK task configuration
 */
function buildSdkTaskConfig(request: ExecutionRequest): SdkTaskConfig {
  const rawSystemPrompt = request.systemPrompt || request.agentConfig.systemPrompt;
  const systemPrompt = resolvePromptPlaceholders(rawSystemPrompt);

  // Build full prompt with context
  const fullPrompt = `
${request.sender ? `Von: ${request.sender}` : ''}
${request.subject ? `Betreff: ${request.subject}` : ''}

${request.prompt}
`.trim();

  return {
    prompt: fullPrompt,
    systemPrompt,
    model: config.agentDefaultModel || 'sonnet',
    maxTurns: request.resources.maxTurns,
    sessionId: request.useResume ? request.sessionId : undefined,
    allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit'],
    agentId: request.agentConfig.id,
  };
}

/**
 * Build environment variables for SDK container
 */
function buildSdkEnvVars(request: ExecutionRequest, taskConfig: SdkTaskConfig): string[] {
  const envVars: string[] = [
    // Task config as JSON
    `AGENT_TASK=${JSON.stringify(taskConfig)}`,

    // API Key (required for SDK)
    `ANTHROPIC_API_KEY=${config.anthropicApiKey || ''}`,

    // Metadata
    `AGENT_ID=${request.agentConfig.id}`,
    `EXECUTION_ID=${request.executionId}`,
  ];

  // Git credentials
  if (config.githubToken) {
    envVars.push(`GITHUB_TOKEN=${config.githubToken}`);
  }
  if (config.gitEmail) {
    envVars.push(`GIT_EMAIL=${config.gitEmail}`);
  }
  if (config.gitName) {
    envVars.push(`GIT_NAME=${config.gitName}`);
  }

  // Agent-specific env vars
  if (request.agentConfig.env) {
    for (const [key, value] of Object.entries(request.agentConfig.env)) {
      const resolvedValue = resolveEnvValue(value);
      if (resolvedValue) {
        envVars.push(`${key}=${resolvedValue}`);
      }
    }
  }

  // MCP-related API keys
  if (config.mocoApiKey) {
    envVars.push(`MOCO_API_KEY=${config.mocoApiKey}`);
  }
  if (config.firecrawlApiKey) {
    envVars.push(`FIRECRAWL_API_KEY=${config.firecrawlApiKey}`);
  }

  return envVars;
}

/**
 * Parse SDK result from container output
 */
function parseSdkOutput(output: string): ExecutionResult {
  const cleanOutput = stripDockerStreamHeaders(output);

  // Try to parse SDK JSON result
  try {
    // Find last JSON object in output (the result)
    const jsonMatches = cleanOutput.match(/\{[^{}]*"success"[^{}]*\}/g);
    if (jsonMatches && jsonMatches.length > 0) {
      const lastJson = jsonMatches[jsonMatches.length - 1];
      const parsed: SdkTaskResult = JSON.parse(lastJson);

      return {
        success: parsed.success,
        summary: parsed.output || parsed.error || 'Task completed',
        filesModified: [],
        authMethod: 'api_key', // SDK always uses API key
        rawOutput: cleanOutput.slice(-5000),
      };
    }
  } catch (e) {
    logger.warn({ error: e }, 'Failed to parse SDK JSON output');
  }

  // Fallback: treat as plain text
  return {
    success: true,
    summary: cleanOutput.slice(-3000) || 'Task completed',
    filesModified: [],
    authMethod: 'api_key',
    rawOutput: cleanOutput.slice(-5000),
  };
}
