/**
 * Guardrail Module
 *
 * Two-stage security system that runs WITHOUT execution rights.
 * Analyzes requests before they reach the execution container.
 */

export { analyzeRequest } from './analyzer.js';
export type {
  GuardrailResult,
  GuardrailDecision,
  GuardrailConfig,
  BlockReason,
} from './types.js';
