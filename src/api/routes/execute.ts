/**
 * Execute API Route
 *
 * POST /api/execute - Execute a task synchronously
 */

import { Router, type Response } from 'express';
import { randomBytes } from 'crypto';
import { executeRequestSchema, type ExecuteResponse, type ApiError } from '../schemas.js';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import { jwtAuth } from '../middleware/jwt-auth.js';
import { executeTask } from '../../execution/unified-executor.js';
import { getAgentById } from '../../agents/registry.js';
import { getOrCreateSession, createSession, hasClaudeSession } from '../../session/index.js';
import { analyzeRequest, type GuardrailResult } from '../../guardrail/index.js';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import type { ExecutionRequest } from '../../execution/types.js';

export const executeRouter = Router();

// Apply JWT auth to all routes
executeRouter.use(jwtAuth);

/**
 * POST /api/execute
 *
 * Execute a task synchronously. Returns when task is complete.
 */
executeRouter.post('/', async (req: AuthenticatedRequest, res: Response) => {
  const startTime = Date.now();
  const executionId = randomBytes(8).toString('hex');

  // Validate request
  const parseResult = executeRequestSchema.safeParse(req.body);
  if (!parseResult.success) {
    const error: ApiError = {
      error: 'Invalid request',
      code: 'VALIDATION_ERROR',
      details: parseResult.error.flatten(),
    };
    res.status(400).json(error);
    return;
  }

  const request = parseResult.data;

  logger.info(
    {
      executionId,
      agentId: request.agentId,
      sessionId: request.sessionId,
      createSession: request.createSession,
      user: req.user?.sub,
    },
    'API execute request received'
  );

  try {
    // Get agent config
    const agentConfig = getAgentById(request.agentId || 'default');
    if (!agentConfig) {
      const error: ApiError = {
        error: `Unknown agent: ${request.agentId}`,
        code: 'AGENT_NOT_FOUND',
      };
      res.status(400).json(error);
      return;
    }

    // Handle session
    let sessionId: string | undefined = request.sessionId;
    let useResume = false;
    let isNewSession = false;

    if (request.sessionId) {
      // Resume existing session
      useResume = await hasClaudeSession(agentConfig.id, request.sessionId);
      logger.info({ sessionId: request.sessionId, useResume }, 'Resuming session');
    } else if (request.createSession) {
      // Create new session
      const session = await createSession({
        agentId: agentConfig.id,
        messageId: `api-${executionId}`,
        subject: `API Request ${executionId}`,
        sender: req.user?.sub || 'api',
      });
      sessionId = session.id;
      isNewSession = true;
      logger.info({ sessionId }, 'Created new session');
    }

    // =============================================
    // STAGE 1: Guardrail Analysis (NO execution rights)
    // Fast pattern matching + optional AI analysis
    // =============================================
    let guardrailResult: GuardrailResult | undefined;

    if (!request.skipSafetyCheck) {
      guardrailResult = await analyzeRequest(request.prompt);

      logger.info(
        {
          executionId,
          decision: guardrailResult.decision,
          reason: guardrailResult.reason,
          confidence: guardrailResult.confidence,
          method: guardrailResult.analysisMethod,
          durationMs: guardrailResult.durationMs,
        },
        'Guardrail analysis completed'
      );

      if (guardrailResult.decision === 'BLOCKED') {
        logger.warn(
          { executionId, reason: guardrailResult.reason },
          'Request blocked by Guardrail'
        );

        res.status(403).json({
          executionId,
          status: 'blocked',
          guardrail: {
            decision: guardrailResult.decision,
            reason: guardrailResult.reason,
            explanation: guardrailResult.explanation,
            confidence: guardrailResult.confidence,
            analysisMethod: guardrailResult.analysisMethod,
          },
          message: 'Anfrage durch Sicherheits-Guardrail abgelehnt',
        });
        return;
      }

      if (guardrailResult.decision === 'ESCALATE') {
        // Future: escalate to human review
        // For now, treat as blocked
        res.status(403).json({
          executionId,
          status: 'escalated',
          guardrail: {
            decision: guardrailResult.decision,
            explanation: guardrailResult.explanation,
          },
          message: 'Anfrage erfordert manuelle Prüfung',
        });
        return;
      }
    }

    // Build execution request
    const executionRequest: ExecutionRequest = {
      executionId,
      prompt: request.prompt,
      agentConfig,
      sessionId,
      useResume,
      isNewSession,
      resources: {
        memoryMb: request.resources?.memoryMb ?? config.agentMemoryMb,
        cpuCores: request.resources?.cpuCores ?? config.agentCpuCores,
        timeoutMs: request.resources?.timeoutMs ?? config.agentTimeoutMs,
        maxTurns: request.resources?.maxTurns ?? config.maxAgentTurns,
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
      sender: req.user?.sub,
    };

    // Execute task
    const result = await executeTask(executionRequest);

    // Build response
    const response: ExecuteResponse = {
      executionId,
      sessionId,
      status: result.success ? 'completed' : 'failed',
      result: {
        success: result.success,
        summary: result.summary,
        filesModified: result.filesModified,
        commitHash: result.commitHash,
        error: result.error,
        modelsUsed: result.modelsUsed,
      },
      guardrail: guardrailResult
        ? {
            decision: guardrailResult.decision,
            confidence: guardrailResult.confidence,
            analysisMethod: guardrailResult.analysisMethod,
            durationMs: guardrailResult.durationMs,
          }
        : undefined,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
    };

    logger.info(
      {
        executionId,
        success: result.success,
        durationMs: response.durationMs,
      },
      'Execution completed'
    );

    res.status(200).json(response);
  } catch (error) {
    logger.error({ error, executionId }, 'Execution failed');

    const apiError: ApiError = {
      error: error instanceof Error ? error.message : 'Unknown error',
      code: 'EXECUTION_ERROR',
    };
    res.status(500).json(apiError);
  }
});
