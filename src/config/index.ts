import { configSchema, type Config } from './schema.js';

function loadConfig(): Config {
  const rawConfig = {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    resendApiKey: process.env.RESEND_API_KEY,
    resendWebhookSecret: process.env.RESEND_WEBHOOK_SECRET,
    agentEmailFrom: process.env.AGENT_EMAIL_FROM,
    claudeSessionPath: process.env.CLAUDE_SESSION_PATH,
    claudeHostPath: process.env.CLAUDE_HOST_PATH,
    githubToken: process.env.GITHUB_TOKEN,
    demoprojektRepoUrl: process.env.DEMOPROJEKT_REPO_URL,
    agentDockerImage: process.env.AGENT_DOCKER_IMAGE,
    maxAgentTurns: parseInt(process.env.MAX_AGENT_TURNS || '50', 10),
    agentTimeoutMs: parseInt(process.env.AGENT_TIMEOUT_MS || '300000', 10),
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
