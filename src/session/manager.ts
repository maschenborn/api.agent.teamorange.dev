/**
 * Session Manager - Handles Claude Code session persistence
 *
 * Sessions are namespaced by agent and identified by short IDs.
 * Claude Code's native session management is used for context persistence.
 */

import { randomBytes } from 'crypto';
import path from 'path';
import fs from 'fs/promises';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type { Session, SessionPaths, SessionIndex } from './types.js';

// Session ID prefix for easy identification
const SESSION_PREFIX = 'to';

// Session index file
const INDEX_FILE = 'session-index.json';

/**
 * Generate a short session ID
 * Format: "abc123" (6 alphanumeric chars)
 */
function generateSessionId(): string {
  return randomBytes(3).toString('hex');
}

/**
 * Extract session ID from email subject
 * Looks for pattern [#to-abc123] or [#abc123]
 */
export function extractSessionIdFromSubject(subject: string): string | null {
  // Match [#to-abc123] or [#abc123]
  const match = subject.match(/\[#(?:to-)?([a-f0-9]{6})\]/i);
  return match ? match[1] : null;
}

/**
 * Format session ID for subject line
 */
export function formatSessionTag(sessionId: string): string {
  return `[#${SESSION_PREFIX}-${sessionId}]`;
}

/**
 * Get the base path for all sessions
 */
function getSessionsBasePath(): string {
  return config.sessionsPath;
}

/**
 * Get paths for a specific session
 */
export function getSessionPaths(agentId: string, sessionId: string): SessionPaths {
  const basePath = getSessionsBasePath();
  const root = path.join(basePath, agentId, sessionId);

  return {
    root,
    workspace: path.join(root, 'workspace'),
    claudeHome: path.join(root, 'claude-home'),
  };
}

/**
 * Load session index from disk
 */
async function loadIndex(): Promise<SessionIndex> {
  const indexPath = path.join(getSessionsBasePath(), INDEX_FILE);

  try {
    const data = await fs.readFile(indexPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    // Index doesn't exist yet
    return { byMessageId: {}, sessions: {} };
  }
}

/**
 * Save session index to disk
 */
async function saveIndex(index: SessionIndex): Promise<void> {
  const basePath = getSessionsBasePath();
  await fs.mkdir(basePath, { recursive: true });

  const indexPath = path.join(basePath, INDEX_FILE);
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2));
}

/**
 * Find existing session by Message-ID (checks In-Reply-To chain)
 */
export async function findSessionByMessageId(messageId: string): Promise<Session | null> {
  const index = await loadIndex();

  const sessionId = index.byMessageId[messageId];
  if (!sessionId) {
    return null;
  }

  const session = index.sessions[sessionId];
  if (!session) {
    logger.warn({ messageId, sessionId }, 'Session ID found in index but session data missing');
    return null;
  }

  return session;
}

/**
 * Find existing session by session ID
 */
export async function findSessionById(sessionId: string): Promise<Session | null> {
  const index = await loadIndex();
  return index.sessions[sessionId] || null;
}

/**
 * Create a new session
 */
export async function createSession(params: {
  agentId: string;
  messageId: string;
  subject: string;
  sender: string;
}): Promise<Session> {
  const { agentId, messageId, subject, sender } = params;

  const sessionId = generateSessionId();
  const now = new Date();

  const session: Session = {
    id: sessionId,
    agentId,
    thread: {
      originalMessageId: messageId,
      messageIds: [messageId],
      originalSubject: subject,
    },
    sender,
    createdAt: now,
    lastActivityAt: now,
  };

  // Create session directories with open permissions
  // (Sandbox container runs as non-root user 'agent')
  // Note: claudeHome is mounted as ~/.claude in container, so NO nested .claude needed!
  const paths = getSessionPaths(agentId, sessionId);
  await fs.mkdir(paths.workspace, { recursive: true, mode: 0o777 });
  await fs.mkdir(paths.claudeHome, { recursive: true, mode: 0o777 });

  // Ensure parent directories are also accessible
  await fs.chmod(paths.root, 0o777);
  await fs.chmod(paths.claudeHome, 0o777);

  // Copy credentials directly to claudeHome (becomes ~/.claude/.credentials.json in container)
  const credentialsSource = path.join(config.claudeSessionPath, '.credentials.json');
  const credentialsTarget = path.join(paths.claudeHome, '.credentials.json');

  try {
    // Check if credentials exist
    await fs.access(credentialsSource);
    // Copy credentials (symlinks don't work across Docker bind mounts reliably)
    await fs.copyFile(credentialsSource, credentialsTarget);
    // Make readable by sandbox user
    await fs.chmod(credentialsTarget, 0o644);
    logger.debug({ credentialsTarget }, 'Credentials copied to session');
  } catch (err) {
    logger.warn({ credentialsSource, error: err }, 'Credentials file not found, session may not authenticate');
  }

  // Update index
  const index = await loadIndex();
  index.sessions[sessionId] = session;
  index.byMessageId[messageId] = sessionId;
  await saveIndex(index);

  logger.info({ sessionId, agentId, messageId }, 'Created new session');

  return session;
}

/**
 * Add a message to an existing session's thread
 */
export async function addMessageToSession(sessionId: string, messageId: string): Promise<void> {
  const index = await loadIndex();

  const session = index.sessions[sessionId];
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  // Add message ID to thread
  if (!session.thread.messageIds.includes(messageId)) {
    session.thread.messageIds.push(messageId);
  }

  // Update last activity
  session.lastActivityAt = new Date();

  // Update index
  index.byMessageId[messageId] = sessionId;
  await saveIndex(index);

  logger.info({ sessionId, messageId }, 'Added message to session');
}

/**
 * Update session with Claude session ID (for --resume)
 */
export async function updateClaudeSessionId(sessionId: string, claudeSessionId: string): Promise<void> {
  const index = await loadIndex();

  const session = index.sessions[sessionId];
  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  session.claudeSessionId = claudeSessionId;
  await saveIndex(index);

  logger.info({ sessionId, claudeSessionId }, 'Updated Claude session ID');
}

/**
 * Check if session has existing Claude session data
 */
export async function hasClaudeSession(agentId: string, sessionId: string): Promise<boolean> {
  const paths = getSessionPaths(agentId, sessionId);

  // Check if Claude projects directory has content
  // claudeHome is mounted as ~/.claude, so projects are at claudeHome/projects
  const projectsDir = path.join(paths.claudeHome, 'projects');

  try {
    const entries = await fs.readdir(projectsDir);
    return entries.length > 0;
  } catch {
    return false;
  }
}

/**
 * Get or create session for an email
 * Handles both new threads and replies
 */
export async function getOrCreateSession(params: {
  agentId: string;
  messageId: string;
  inReplyTo?: string;
  subject: string;
  sender: string;
}): Promise<{ session: Session; isNew: boolean }> {
  const { agentId, messageId, inReplyTo, subject, sender } = params;

  // 1. Check if this is a reply to an existing session
  if (inReplyTo) {
    const existingSession = await findSessionByMessageId(inReplyTo);
    if (existingSession) {
      await addMessageToSession(existingSession.id, messageId);
      return { session: existingSession, isNew: false };
    }
  }

  // 2. Check if subject contains session tag
  const sessionIdFromSubject = extractSessionIdFromSubject(subject);
  if (sessionIdFromSubject) {
    const existingSession = await findSessionById(sessionIdFromSubject);
    if (existingSession) {
      await addMessageToSession(existingSession.id, messageId);
      return { session: existingSession, isNew: false };
    }
  }

  // 3. Create new session
  const session = await createSession({ agentId, messageId, subject, sender });
  return { session, isNew: true };
}
