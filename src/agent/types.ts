export interface AgentTask {
  id: string;
  description: string;
  summary: string;
  emailId: string;
  sender: string;
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
