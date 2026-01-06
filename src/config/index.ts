import { configSchema, type Config } from './schema.js';

function loadConfig(): Config {
  const rawConfig = {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',

    // API Authentication
    jwtSecret: process.env.JWT_SECRET,
    jwtIssuer: process.env.JWT_ISSUER,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN,

    // Resend
    resendApiKey: process.env.RESEND_API_KEY,
    resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET,
    agentEmailFrom: process.env.AGENT_EMAIL_FROM,

    // Claude
    claudeSessionPath: process.env.CLAUDE_SESSION_PATH,
    claudeHostPath: process.env.CLAUDE_HOST_PATH,
    sessionsPath: process.env.SESSIONS_PATH,
    sessionsHostPath: process.env.SESSIONS_HOST_PATH,

    // GitHub
    githubToken: process.env.GITHUB_TOKEN,
    demoprojektRepoUrl: process.env.DEMOPROJEKT_REPO_URL,

    // Agent Container
    agentDockerImage: process.env.AGENT_DOCKER_IMAGE,
    maxAgentTurns: parseInt(process.env.MAX_AGENT_TURNS || '50', 10),
    agentTimeoutMs: parseInt(process.env.AGENT_TIMEOUT_MS || '300000', 10),
    agentMemoryMb: parseInt(process.env.AGENT_MEMORY_MB || '2048', 10),
    agentCpuCores: parseInt(process.env.AGENT_CPU_CORES || '2', 10),

    // MCP API Keys
    mocoApiKey: process.env.MOCO_API_KEY,
    firecrawlApiKey: process.env.FIRECRAWL_API_KEY,

    // Guardrail AI
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,

    // Git
    gitEmail: process.env.GIT_EMAIL,
    gitName: process.env.GIT_NAME,
  };

  const result = configSchema.safeParse(rawConfig);

  if (!result.success) {
    console.error('❌ Invalid configuration:');
    console.error(result.error.format());
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();
export type { Config };
