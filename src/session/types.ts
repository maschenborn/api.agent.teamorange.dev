/**
 * Session management types for persistent Claude Code sessions
 */

export interface Session {
  /** Short unique ID, e.g. "abc123" */
  id: string;

  /** Agent namespace (e.g., "test", "moco", "default") */
  agentId: string;

  /** Email thread tracking */
  thread: {
    /** Original Message-ID that started the thread */
    originalMessageId: string;
    /** All Message-IDs in this thread */
    messageIds: string[];
    /** Original subject (without session tag) */
    originalSubject: string;
  };

  /** Sender email address */
  sender: string;

  /** Creation timestamp */
  createdAt: Date;

  /** Last activity timestamp */
  lastActivityAt: Date;

  /** Claude Code session ID (if exists) */
  claudeSessionId?: string;
}

export interface SessionPaths {
  /** Root directory for this session */
  root: string;
  /** Workspace directory (for git repos, etc.) */
  workspace: string;
  /** Claude home directory - mounted as ~/.claude in container */
  claudeHome: string;
}

export interface SessionIndex {
  /** Map Message-ID → Session ID */
  byMessageId: Record<string, string>;
  /** Map Session ID → Session */
  sessions: Record<string, Session>;
}
