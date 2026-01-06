/**
 * Status API Routes
 *
 * GET /api/status - List running/recent executions
 * GET /api/status/:id - Get specific execution status
 */

import { Router, type Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import { jwtAuth } from '../middleware/jwt-auth.js';
import { listExecutions, getExecutionStatus } from '../../execution/unified-executor.js';
import type { StatusListResponse, ExecutionStatus as ApiExecutionStatus, ApiError } from '../schemas.js';

export const statusRouter = Router();

// Apply JWT auth to all routes
statusRouter.use(jwtAuth);

/**
 * GET /api/status
 *
 * List all running and recently completed executions
 */
statusRouter.get('/', (req: AuthenticatedRequest, res: Response) => {
  const executions = listExecutions();

  const response: StatusListResponse = {
    executions: executions.map((exec) => ({
      executionId: exec.executionId,
      status: exec.status,
      agentId: exec.agentId,
      sessionId: exec.sessionId,
      prompt: exec.prompt,
      startedAt: exec.startedAt.toISOString(),
      completedAt: exec.completedAt?.toISOString(),
      durationMs: exec.completedAt
        ? exec.completedAt.getTime() - exec.startedAt.getTime()
        : Date.now() - exec.startedAt.getTime(),
    })),
    total: executions.length,
  };

  res.json(response);
});

/**
 * GET /api/status/:id
 *
 * Get status of a specific execution
 */
statusRouter.get('/:id', (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const execution = getExecutionStatus(id);

  if (!execution) {
    const error: ApiError = {
      error: `Execution not found: ${id}`,
      code: 'EXECUTION_NOT_FOUND',
    };
    res.status(404).json(error);
    return;
  }

  const response: ApiExecutionStatus = {
    executionId: execution.executionId,
    status: execution.status,
    agentId: execution.agentId,
    sessionId: execution.sessionId,
    prompt: execution.prompt,
    startedAt: execution.startedAt.toISOString(),
    completedAt: execution.completedAt?.toISOString(),
    durationMs: execution.completedAt
      ? execution.completedAt.getTime() - execution.startedAt.getTime()
      : Date.now() - execution.startedAt.getTime(),
  };

  res.json(response);
});
