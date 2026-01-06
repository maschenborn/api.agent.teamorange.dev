/**
 * Guardrail Types
 *
 * Types for the two-stage security system.
 * Guardrail runs WITHOUT execution rights - only text analysis.
 */

export type GuardrailDecision = 'APPROVED' | 'BLOCKED' | 'ESCALATE';

export type BlockReason =
  | 'DESTRUCTIVE'      // rm -rf, DROP DATABASE, delete all
  | 'PROMPT_INJECTION' // Ignore instructions, jailbreak attempts
  | 'COMPETENCE_EXCEEDED' // Architecture changes, system modifications
  | 'FINANCIAL_RISK'   // Money transfers, payment changes
  | 'SECURITY_RISK'    // Credential access, auth bypass
  | 'UNCLEAR'          // Cannot understand the request
  | 'OTHER';

export interface GuardrailResult {
  decision: GuardrailDecision;
  reason?: BlockReason;
  explanation: string;
  confidence: number; // 0-1, how confident the guardrail is
  analysisMethod: 'pattern' | 'ai' | 'hybrid';
  durationMs: number;
}

export interface GuardrailConfig {
  /** Enable AI-powered analysis (requires ANTHROPIC_API_KEY) */
  useAiAnalysis: boolean;
  /** Confidence threshold for pattern matching (0-1) */
  patternConfidenceThreshold: number;
  /** Model to use for AI analysis */
  aiModel: string;
  /** Timeout for AI analysis in ms */
  aiTimeoutMs: number;
}

// Pattern definitions for fast matching
export interface ThreatPattern {
  category: BlockReason;
  patterns: RegExp[];
  severity: 'high' | 'medium' | 'low';
  explanation: string;
}
