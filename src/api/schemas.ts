/**
 * API Request/Response Schemas
 *
 * Zod schemas for validating API requests and typing responses.
 */

import { z } from 'zod';

// ============================================
// MCP Configuration
// ============================================

export const mcpServerConfigSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const mcpConfigSchema = z.object({
  /** Preset MCP servers to enable: "moco", "firecrawl" */
  preset: z.array(z.enum(['moco', 'firecrawl'])).optional(),
  /** Custom MCP server configurations */
  custom: z.array(mcpServerConfigSchema).optional(),
});

// ============================================
// Resource Configuration
// ============================================

export const resourceConfigSchema = z.object({
  /** Memory limit in MB (512-8192, default: 2048) */
  memoryMb: z.number().min(512).max(8192).optional(),
  /** CPU cores (1-4, default: 2) */
  cpuCores: z.number().min(1).max(4).optional(),
  /** Timeout in milliseconds (30000-600000, default: 300000) */
  timeoutMs: z.number().min(30000).max(600000).optional(),
  /** Max Claude turns (1-200, default: 50) */
  maxTurns: z.number().min(1).max(200).optional(),
});

// ============================================
// Git Configuration
// ============================================

export const gitConfigSchema = z.object({
  /** Git repository URL to clone */
  repoUrl: z.string().url().optional(),
  /** Branch to checkout (default: main) */
  branch: z.string().optional(),
});

// ============================================
// Execute Request
// ============================================

export const executeRequestSchema = z.object({
  /** Task prompt/description (required) */
  prompt: z.string().min(1).max(50000),

  /** Agent ID: "test", "moco", "default" */
  agentId: z.enum(['test', 'moco', 'default']).optional().default('default'),

  /** Resume existing session by ID */
  sessionId: z.string().regex(/^[a-f0-9]{6}$/).optional(),

  /** Create new persistent session (default: false) */
  createSession: z.boolean().optional().default(false),

  /** Resource configuration */
  resources: resourceConfigSchema.optional(),

  /** MCP server configuration */
  mcpConfig: mcpConfigSchema.optional(),

  /** Git repository configuration */
  git: gitConfigSchema.optional(),

  /** Skip safety analysis (use with caution) */
  skipSafetyCheck: z.boolean().optional().default(false),

  /** Custom system prompt override */
  systemPrompt: z.string().max(10000).optional(),
});

export type ExecuteRequest = z.infer<typeof executeRequestSchema>;

// ============================================
// Execute Response
// ============================================

export interface ExecuteResponse {
  /** Unique execution ID */
  executionId: string;

  /** Session ID (if session mode) */
  sessionId?: string;

  /** Execution status */
  status: 'completed' | 'failed';

  /** Execution result */
  result: {
    success: boolean;
    summary: string;
    filesModified?: string[];
    commitHash?: string;
    error?: string;
    modelsUsed?: string[];
  };

  /** Timestamps */
  startedAt: string;
  completedAt: string;
  durationMs: number;
}

// ============================================
// Status Response
// ============================================

export interface ExecutionStatus {
  executionId: string;
  status: 'running' | 'completed' | 'failed';
  agentId: string;
  sessionId?: string;
  prompt: string;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface StatusListResponse {
  executions: ExecutionStatus[];
  total: number;
}

// ============================================
// Session Response
// ============================================

export interface SessionInfo {
  id: string;
  agentId: string;
  sender: string;
  createdAt: string;
  lastActivityAt: string;
  messageCount: number;
  hasClaudeSession: boolean;
}

export interface SessionListResponse {
  sessions: SessionInfo[];
  total: number;
}

// ============================================
// Error Response
// ============================================

export interface ApiError {
  error: string;
  code: string;
  details?: unknown;
}
