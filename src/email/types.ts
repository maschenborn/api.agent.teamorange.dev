export interface ResendEmailReceivedEvent {
  type: 'email.received';
  created_at: string;
  data: {
    email_id: string;
    created_at: string;
    from: string;
    to: string[];
    cc: string[];
    bcc: string[];
    subject: string;
    text: string | null;
    html: string | null;
    message_id: string;
    headers: Record<string, string>;
    attachments: Array<{
      id: string;
      filename: string;
      content_type: string;
    }>;
  };
}

export interface ReceivedEmail {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  html: string | null;
  text: string | null;
  created_at: string;
  message_id: string;
  headers: Record<string, string>;
  attachments: Array<{
    id: string;
    filename: string;
    content_type: string;
  }>;
}

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface TaskReceivedParams {
  to: string;
  taskSummary: string;
  originalSubject: string;
  originalMessageId: string;
  sessionId?: string;
}

export interface TaskCompletedParams {
  to: string;
  taskSummary: string;
  result: AgentResult;
  originalSubject: string;
  originalMessageId: string;
  sessionId?: string;
  debugDump?: DebugDump; // Included when subject contains /dump
}

export interface TaskFailedParams {
  to: string;
  error: string;
  originalSubject: string;
  originalMessageId: string;
  sessionId?: string;
}

export type RejectionReason = 'unclear' | 'harmful' | 'too_complex';

export interface TaskRejectedParams {
  to: string;
  reason: RejectionReason;
  explanation: string;
  suggestion?: string;
  originalSubject: string;
  originalMessageId: string;
}

export interface AgentResult {
  success: boolean;
  summary: string;
  filesModified: string[];
  commitHash?: string;
  deployUrl?: string;
  modelsUsed?: string[]; // e.g. ['Haiku 4.5', 'Opus 4.5']
  authMethod?: 'oauth' | 'api_key'; // oauth = Subscription, api_key = Pay-as-you-go
}

/**
 * Debug dump information for /dump command
 * Included in response email when subject contains "/dump"
 */
export interface DebugDump {
  // Request info
  emailId: string;
  sender: string;
  recipient: string;
  subject: string;
  receivedAt: string;

  // Agent config
  agentId: string;
  agentName: string;
  agentDescription: string;
  systemPromptPreview: string; // First 500 chars

  // Session
  sessionId: string;
  isNewSession: boolean;

  // Guardrail
  guardrail: {
    decision: string;
    reason?: string;
    explanation: string;
    confidence: number;
    method: string;
    durationMs: number;
  };

  // Execution
  prompt: string;
  executionId: string;
  model: string;
  maxTurns: number;
  allowedTools: string[];

  // MCP
  mcpServers: string[];

  // Available agents
  availableAgents: Array<{
    id: string;
    name: string;
    email: string;
  }>;

  // Timing & Cost
  totalDurationMs: number;
  turns?: number;
  costUsd?: number;

  // Tool calls (for debugging)
  toolCalls?: Array<{
    tool: string;
    input: string;
    output?: string;
  }>;

  rawOutput?: string; // Last 10000 chars
}
