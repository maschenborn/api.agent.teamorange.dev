/**
 * Sessions API Routes
 *
 * GET /api/sessions - List all sessions
 * GET /api/sessions/:id - Get specific session
 */

import { Router, type Response } from 'express';
import type { AuthenticatedRequest } from '../middleware/jwt-auth.js';
import { jwtAuth } from '../middleware/jwt-auth.js';
import { findSessionById, hasClaudeSession } from '../../session/index.js';
import type { SessionListResponse, SessionInfo, ApiError } from '../schemas.js';
import { config } from '../../config/index.js';
import fs from 'fs/promises';
import path from 'path';

export const sessionsRouter = Router();

// Apply JWT auth to all routes
sessionsRouter.use(jwtAuth);

/**
 * GET /api/sessions
 *
 * List all sessions
 */
sessionsRouter.get('/', async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Read session index
    const indexPath = path.join(config.sessionsPath, 'session-index.json');
    let sessions: SessionInfo[] = [];

    try {
      const indexData = await fs.readFile(indexPath, 'utf-8');
      const index = JSON.parse(indexData);

      // Convert to SessionInfo array
      for (const [sessionId, session] of Object.entries(index.sessions)) {
        const s = session as {
          id: string;
          agentId: string;
          sender: string;
          createdAt: string;
          lastActivityAt: string;
          thread: { messageIds: string[] };
        };

        const hasClaude = await hasClaudeSession(s.agentId, s.id);

        sessions.push({
          id: s.id,
          agentId: s.agentId,
          sender: s.sender,
          createdAt: s.createdAt,
          lastActivityAt: s.lastActivityAt,
          messageCount: s.thread.messageIds.length,
          hasClaudeSession: hasClaude,
        });
      }
    } catch {
      // No sessions yet
    }

    // Sort by last activity (most recent first)
    sessions.sort(
      (a, b) =>
        new Date(b.lastActivityAt).getTime() - new Date(a.lastActivityAt).getTime()
    );

    const response: SessionListResponse = {
      sessions,
      total: sessions.length,
    };

    res.json(response);
  } catch (error) {
    const apiError: ApiError = {
      error: 'Failed to list sessions',
      code: 'SESSION_LIST_ERROR',
    };
    res.status(500).json(apiError);
  }
});

/**
 * GET /api/sessions/:id
 *
 * Get details of a specific session
 */
sessionsRouter.get('/:id', async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;

  try {
    const session = await findSessionById(id);

    if (!session) {
      const error: ApiError = {
        error: `Session not found: ${id}`,
        code: 'SESSION_NOT_FOUND',
      };
      res.status(404).json(error);
      return;
    }

    const hasClaude = await hasClaudeSession(session.agentId, session.id);

    const response: SessionInfo = {
      id: session.id,
      agentId: session.agentId,
      sender: session.sender,
      createdAt:
        session.createdAt instanceof Date
          ? session.createdAt.toISOString()
          : String(session.createdAt),
      lastActivityAt:
        session.lastActivityAt instanceof Date
          ? session.lastActivityAt.toISOString()
          : String(session.lastActivityAt),
      messageCount: session.thread.messageIds.length,
      hasClaudeSession: hasClaude,
    };

    res.json(response);
  } catch (error) {
    const apiError: ApiError = {
      error: 'Failed to get session',
      code: 'SESSION_GET_ERROR',
    };
    res.status(500).json(apiError);
  }
});
