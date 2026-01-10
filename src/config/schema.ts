import { z } from 'zod';

export const configSchema = z.object({
  // Server
  port: z.number().min(1).max(65535).default(3000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  // API Authentication
  jwtSecret: z.string().min(32).optional(), // Required for API, optional for email-only mode
  jwtIssuer: z.string().default('agent.teamorange.dev'),
  jwtExpiresIn: z.string().default('30d'), // Default token validity

  // Resend
  resendApiKey: z.string().startsWith('re_'),
  resendWebhookSecret: z.string().min(1),
  agentEmailFrom: z.string().email(),

  // Claude Code Session (mounted from host ~/.claude/)
  claudeSessionPath: z.string().min(1),
  // Host path for Claude credentials (needed for Docker-in-Docker bind mounts)
  claudeHostPath: z.string().min(1).default('/opt/claude'),
  // Path for persistent sessions (host path that Docker daemon can access)
  sessionsPath: z.string().min(1).default('/opt/claude-sessions'),
  // Host path for sessions (for Docker-in-Docker bind mounts)
  sessionsHostPath: z.string().min(1).default('/opt/claude-sessions'),

  // GitHub (optional - only needed for git operations)
  githubToken: z.string().optional(),
  demoprojektRepoUrl: z.string().optional(),

  // Agent Container
  agentDockerImage: z.string().default('claude-agent-sdk:latest'),
  agentDefaultModel: z.string().default('opus'), // Claude model: opus, sonnet, haiku
  maxAgentTurns: z.number().min(1).max(200).default(50),
  agentTimeoutMs: z.number().min(30000).max(600000).default(300000), // 5 min default

  // Agent Resource Limits (configurable via API, these are defaults)
  agentMemoryMb: z.number().min(512).max(8192).default(2048),
  agentCpuCores: z.number().min(1).max(4).default(2),

  // MCP (optional API keys for preset MCP servers)
  mocoApiKey: z.string().optional(),
  firecrawlApiKey: z.string().optional(),

  // Guardrail AI (optional - enables AI-powered threat detection)
  anthropicApiKey: z.string().optional(),

  // Debug Token (allows debug endpoints in production when provided)
  debugToken: z.string().min(32).optional(),

  // Git
  gitEmail: z.string().email().default('agent@claude-remote.local'),
  gitName: z.string().default('Claude Remote Agent'),
});

export type Config = z.infer<typeof configSchema>;
