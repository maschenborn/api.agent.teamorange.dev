/**
 * Execution Types
 *
 * Unified types for task execution across all channels (API, Email, etc.)
 */

import type { ExecuteRequest } from '../api/schemas.js';
import type { AgentConfig } from '../agents/registry.js';

// ============================================
// Execution Request (Internal)
// ============================================

export interface ExecutionRequest {
  /** Unique execution ID */
  executionId: string;

  /** Task prompt */
  prompt: string;

  /** Agent configuration */
  agentConfig: AgentConfig;

  /** Session ID (if resuming or creating) */
  sessionId?: string;

  /** Whether to use --resume flag */
  useResume: boolean;

  /** Whether this is a new session */
  isNewSession: boolean;

  /** Resource configuration */
  resources: {
    memoryMb: number;
    cpuCores: number;
    timeoutMs: number;
    maxTurns: number;
  };

  /** MCP configuration */
  mcpConfig?: {
    preset?: string[];
    custom?: Array<{
      name: string;
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }>;
  };

  /** Git configuration */
  git?: {
    repoUrl?: string;
    branch?: string;
  };

  /** Skip safety analysis */
  skipSafetyCheck: boolean;

  /** Custom system prompt override */
  systemPrompt?: string;

  /** Source of the request */
  source: 'api' | 'email' | 'teams';

  /** Original sender (email address or user ID) */
  sender?: string;

  /** Email subject (if from email) */
  subject?: string;
}

// ============================================
// Execution Result
// ============================================

/** Tool call tracked from SDK execution */
export interface ToolCall {
  tool: string;
  input: string;
  output?: string;
}

export interface ExecutionResult {
  success: boolean;
  summary: string;
  filesModified: string[];
  commitHash?: string;
  error?: string;
  modelsUsed?: string[];
  /** Authentication method used: oauth (subscription) or api_key (pay-as-you-go) */
  authMethod?: 'oauth' | 'api_key';
  rawOutput?: string;
  /** Total cost in USD (from SDK) */
  costUsd?: number;
  /** Number of turns/iterations (from SDK) */
  turns?: number;
  /** Input tokens used */
  inputTokens?: number;
  /** Output tokens used */
  outputTokens?: number;
  /** Bash tool calls made during execution */
  toolCalls?: ToolCall[];
}

// ============================================
// Execution Status (for tracking)
// ============================================

export interface ExecutionStatus {
  executionId: string;
  status: 'running' | 'completed' | 'failed';
  agentId: string;
  sessionId?: string;
  prompt: string;
  source: 'api' | 'email' | 'teams';
  sender?: string;
  startedAt: Date;
  completedAt?: Date;
  result?: ExecutionResult;
}

// ============================================
// Conversion Helpers
// ============================================

/**
 * Convert API request to internal ExecutionRequest
 */
export function apiRequestToExecution(
  request: ExecuteRequest,
  executionId: string,
  agentConfig: AgentConfig,
  sessionId: string | undefined,
  useResume: boolean,
  isNewSession: boolean,
  defaultResources: {
    memoryMb: number;
    cpuCores: number;
    timeoutMs: number;
    maxTurns: number;
  }
): ExecutionRequest {
  return {
    executionId,
    prompt: request.prompt,
    agentConfig,
    sessionId,
    useResume,
    isNewSession,
    resources: {
      memoryMb: request.resources?.memoryMb ?? defaultResources.memoryMb,
      cpuCores: request.resources?.cpuCores ?? defaultResources.cpuCores,
      timeoutMs: request.resources?.timeoutMs ?? defaultResources.timeoutMs,
      maxTurns: request.resources?.maxTurns ?? defaultResources.maxTurns,
    },
    mcpConfig: request.mcpConfig
      ? {
          preset: request.mcpConfig.preset,
          custom: request.mcpConfig.custom?.map((c) => ({
            ...c,
            env: c.env as Record<string, string> | undefined,
          })),
        }
      : undefined,
    git: request.git,
    skipSafetyCheck: request.skipSafetyCheck ?? false,
    systemPrompt: request.systemPrompt,
    source: 'api',
    sender: undefined, // Set by caller
  };
}
