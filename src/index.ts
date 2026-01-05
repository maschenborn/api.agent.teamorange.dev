import { startServer } from './webhook/server.js';
import { logger } from './utils/logger.js';
import { config } from './config/index.js';

logger.info({ nodeEnv: config.nodeEnv }, '🤖 Claude Remote Agent starting...');

// Log configuration (without secrets)
logger.info({
  port: config.port,
  agentImage: config.agentDockerImage,
  maxTurns: config.maxAgentTurns,
  timeoutMs: config.agentTimeoutMs,
}, 'Configuration loaded');

// Start the webhook server
startServer();
