export interface AgentTask {
  id: string;
  description: string;
  summary: string;
  emailId: string;
  sender: string;
  recipient: string; // The email address this was sent TO (determines agent type)
  subject: string;
  messageId: string;
  createdAt: Date;
}

export interface AgentResult {
  success: boolean;
  summary: string;
  filesModified: string[];
  commitHash?: string;
  output?: string;
  error?: string;
  modelsUsed?: string[]; // e.g. ['claude-haiku-4-5', 'claude-opus-4-5']
}

export interface AgentContainerConfig {
  image: string;
  prompt: string;
  repoUrl: string;
  maxTurns: number;
  timeoutMs: number;
  env: Record<string, string>;
}

export type SafetyRejectionReason = 'unclear' | 'harmful' | 'too_complex';

export interface SafetyAnalysisResult {
  approved: boolean;
  reason?: SafetyRejectionReason;
  explanation: string;
  suggestedClarification?: string;
}
