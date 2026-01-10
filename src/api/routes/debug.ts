/**
 * Debug Routes
 *
 * Internal endpoints for testing and debugging.
 * ONLY enable in development/testing environments!
 */

import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'crypto';
import { executeTask } from '../../execution/unified-executor.js';
import { getAgentById, getAllAgents } from '../../agents/registry.js';
import { createSession } from '../../session/index.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import type { ExecutionRequest } from '../../execution/types.js';

export const debugRouter = Router();

/**
 * GET /debug/agents
 *
 * List all registered agents
 */
debugRouter.get('/agents', (_req: Request, res: Response) => {
  const agents = getAllAgents();
  res.json({
    count: agents.length,
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
    })),
  });
});

/**
 * POST /debug/execute
 *
 * Execute a task directly without JWT auth.
 * For internal testing only!
 */
debugRouter.post('/execute', async (req: Request, res: Response) => {
  // Only allow in development
  if (config.nodeEnv === 'production') {
    res.status(403).json({ error: 'Debug endpoints disabled in production' });
    return;
  }

  const startTime = Date.now();
  const executionId = randomBytes(8).toString('hex');

  const { prompt, agentId = 'test', systemPrompt } = req.body;

  if (!prompt) {
    res.status(400).json({ error: 'prompt is required' });
    return;
  }

  logger.info({ executionId, agentId, prompt: prompt.slice(0, 100) }, 'Debug execute request');

  try {
    // Get agent config
    const agentConfig = getAgentById(agentId);
    if (!agentConfig) {
      res.status(400).json({ error: `Unknown agent: ${agentId}` });
      return;
    }

    // Create session for this execution
    const session = await createSession({
      agentId: agentConfig.id,
      messageId: `debug-${executionId}`,
      subject: `Debug: ${prompt.slice(0, 50)}`,
      sender: 'debug@internal',
    });

    // Build execution request
    const executionRequest: ExecutionRequest = {
      executionId,
      prompt,
      agentConfig,
      sessionId: session.id,
      useResume: false,
      isNewSession: true,
      resources: {
        memoryMb: config.agentMemoryMb,
        cpuCores: config.agentCpuCores,
        timeoutMs: config.agentTimeoutMs,
        maxTurns: config.maxAgentTurns,
      },
      skipSafetyCheck: true, // Skip guardrails for debug
      systemPrompt,
      source: 'api',
      sender: 'debug',
    };

    // Execute
    const result = await executeTask(executionRequest);

    res.json({
      executionId,
      sessionId: session.id,
      success: result.success,
      summary: result.summary,
      authMethod: result.authMethod,
      durationMs: Date.now() - startTime,
      rawOutput: result.rawOutput?.slice(-2000),
    });
  } catch (error) {
    logger.error({ error, executionId }, 'Debug execution failed');
    res.status(500).json({
      executionId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /debug/config
 *
 * Show non-sensitive config values
 */
debugRouter.get('/config', (_req: Request, res: Response) => {
  // Only allow in development
  if (config.nodeEnv === 'production') {
    res.status(403).json({ error: 'Debug endpoints disabled in production' });
    return;
  }

  res.json({
    nodeEnv: config.nodeEnv,
    agentDockerImage: config.agentDockerImage,
    agentDefaultModel: config.agentDefaultModel,
    maxAgentTurns: config.maxAgentTurns,
    agentTimeoutMs: config.agentTimeoutMs,
    agentMemoryMb: config.agentMemoryMb,
    agentCpuCores: config.agentCpuCores,
    hasAnthropicKey: !!config.anthropicApiKey,
    hasMocoKey: !!config.mocoApiKey,
    hasFirecrawlKey: !!config.firecrawlApiKey,
  });
});
