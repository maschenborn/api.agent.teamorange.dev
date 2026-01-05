import { z } from 'zod';

export const configSchema = z.object({
  // Server
  port: z.number().min(1).max(65535).default(3000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),

  // Resend
  resendApiKey: z.string().startsWith('re_'),
  resendWebhookSecret: z.string().min(1),
  agentEmailFrom: z.string().email(),

  // Claude Code Session (mounted from host ~/.claude/)
  claudeSessionPath: z.string().min(1),

  // GitHub (optional - only needed for git operations)
  githubToken: z.string().optional(),
  demoprojektRepoUrl: z.string().optional(),

  // Agent
  agentDockerImage: z.string().default('claude-remote-agent-sandbox:latest'),
  maxAgentTurns: z.number().min(1).max(200).default(50),
  agentTimeoutMs: z.number().min(30000).max(600000).default(300000), // 5 min default

  // Git
  gitEmail: z.string().email().default('agent@claude-remote.local'),
  gitName: z.string().default('Claude Remote Agent'),
});

export type Config = z.infer<typeof configSchema>;
