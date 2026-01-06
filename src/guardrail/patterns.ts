/**
 * Threat Patterns for Fast Guardrail Analysis
 *
 * These patterns provide fast, deterministic matching for obvious threats.
 * More nuanced analysis is done by the AI layer.
 */

import type { ThreatPattern } from './types.js';

export const THREAT_PATTERNS: ThreatPattern[] = [
  // =============================================
  // DESTRUCTIVE - Irreversible data destruction
  // =============================================
  {
    category: 'DESTRUCTIVE',
    severity: 'high',
    explanation: 'Destruktiver Befehl erkannt - Datenverlust möglich',
    patterns: [
      /\brm\s+-rf\b/i,
      /\brmdir\b.*\/\s*$/i,
      /\bdrop\s+(database|table|schema)\b/i,
      /\btruncate\s+table\b/i,
      /\bdelete\s+from\b.*where\s+1\s*=\s*1/i,
      /\bformat(iere|ieren)?\s+(die\s+)?(festplatte|disk|laufwerk|partition)/i,
      /lösch(e|en)?\s+(alle|sämtliche)\s+(dateien|daten|files)/i,
      /\bentfern(e|en)?\s+(alle|sämtliche|komplett)/i,
      /\bwipe\b/i,
      /\bdestroy\b/i,
      /\bnuke\b/i,
    ],
  },

  // =============================================
  // PROMPT INJECTION - Attempts to override instructions
  // =============================================
  {
    category: 'PROMPT_INJECTION',
    severity: 'high',
    explanation: 'Prompt Injection Versuch erkannt',
    patterns: [
      /ignor(e|iere)\s+(alle\s+)?(vorherigen?|bisherigen?|obigen?)\s+(anweisungen?|instructions?|regeln?)/i,
      /vergiss\s+(alle\s+)?(vorherigen?|bisherigen?)\s+(anweisungen?|regeln?)/i,
      /du\s+bist\s+(jetzt|nun|ab\s+sofort)\s+(ein|eine)/i,
      /neue\s+(rolle|identity|identität)/i,
      /\bjailbreak\b/i,
      /\bbypass\b.*\b(restrictions?|einschränkungen?|regeln?)\b/i,
      /\bdeveloper\s+mode\b/i,
      /\bdan\s+mode\b/i,
      /\bsystem\s+prompt\b/i,
      /\boverride\b.*\binstructions?\b/i,
      /tu\s+so\s+als\s+(ob|wärst)/i,
      /stell\s+dir\s+vor\s+du\s+(bist|wärst)/i,
      /admin[\s-]?(zugang|access|rechte|modus)/i,
      /\brole\s*:\s*(system|admin|root)\b/i,
    ],
  },

  // =============================================
  // COMPETENCE_EXCEEDED - Beyond editor permissions
  // =============================================
  {
    category: 'COMPETENCE_EXCEEDED',
    severity: 'medium',
    explanation: 'Anfrage überschreitet Redakteur-Kompetenz',
    patterns: [
      /(änder|ersetze|modifiziere)\s+(das\s+)?(komplette?|gesamte?|ganze?)\s+(navigations?konzept|architektur|design|system)/i,
      /\b(redesign|neugestaltung|komplett\s+neu)\b.*\b(website|app|system|plattform)\b/i,
      /entfern(e|en)?\s+(alle\s+)?(menüs?|navigation|sidebar)/i,
      /(server|infrastruktur|deployment)\s*(konfiguration|config)?\s*(ändern|modifizieren|anpassen)/i,
      /\b(refactor|umstrukturier)\s*(das\s+)?(gesamte?|komplette?|ganze?)\b/i,
      /datenbank[\s-]?(schema|struktur|migration)\s*(ändern|anpassen|modifizieren)/i,
      /(api|endpoint|schnittstelle)\s*(komplett|ganz)\s*(ändern|umbauen|ersetzen)/i,
    ],
  },

  // =============================================
  // FINANCIAL_RISK - Money-related actions
  // =============================================
  {
    category: 'FINANCIAL_RISK',
    severity: 'high',
    explanation: 'Finanzielle Transaktion erkannt - manuelle Bestätigung erforderlich',
    patterns: [
      /überweis(e|en|ung)\s+\d+/i,
      /transfer(iere)?\s+\d+\s*(euro|eur|€|\$|dollar)/i,
      /(ändere?|ändern)\s+(die\s+)?bankverbindung/i,
      /\b(iban|bic|konto)\s*(ändern|aktualisieren|ersetzen)\b/i,
      /zahlungs(daten|informationen?)\s*(ändern|aktualisieren)/i,
      /\bpaypal\b.*\b(senden|überweisen|transfer)\b/i,
      /\brechnung\b.*\b(bezahlen|begleichen)\b.*\d+/i,
    ],
  },

  // =============================================
  // SECURITY_RISK - Credential/auth related
  // =============================================
  {
    category: 'SECURITY_RISK',
    severity: 'high',
    explanation: 'Sicherheitsrelevante Anfrage erkannt',
    patterns: [
      /\b(passwort|password|kennwort|pwd)\s*(zeigen?|anzeigen?|ausgeben?|auflisten?)/i,
      /\b(api[\s-]?key|token|secret|credential)\s*(zeigen?|anzeigen?|auflisten?)/i,
      /\b(ssh|private)[\s-]?key\b/i,
      /\bauth(entifizierung|entication)?\s*(deaktivier|entfern|abschalt)/i,
      /\bbypass\s*(auth|login|security)\b/i,
      /\.env\s*(datei)?\s*(zeigen?|lesen?|ausgeben?)/i,
      /\b(zugang|access)\s*(für\s+alle|öffentlich|ohne\s+(passwort|login))/i,
      /\broot\s*(zugang|access|rechte)\b/i,
      /\bsudo\b.*\bpasswd\b/i,
    ],
  },
];

/**
 * Check a prompt against all threat patterns
 */
export function matchThreatPatterns(prompt: string): {
  matched: boolean;
  category?: string;
  severity?: string;
  explanation?: string;
  confidence: number;
} {
  const normalizedPrompt = prompt.toLowerCase();

  for (const threat of THREAT_PATTERNS) {
    for (const pattern of threat.patterns) {
      if (pattern.test(prompt)) {
        return {
          matched: true,
          category: threat.category,
          severity: threat.severity,
          explanation: threat.explanation,
          confidence: threat.severity === 'high' ? 0.95 : threat.severity === 'medium' ? 0.8 : 0.6,
        };
      }
    }
  }

  return {
    matched: false,
    confidence: 0,
  };
}

/**
 * Quick check for obvious safe requests (questions, greetings)
 */
export function isObviouslySafe(prompt: string): boolean {
  const safePatterns = [
    /^(hallo|hi|guten\s+(tag|morgen|abend)|servus|moin)/i,
    /^(wie|was|wer|wann|wo|warum|welche)\s/i,
    /^(danke|vielen\s+dank|merci)/i,
    /\?([\s\n]*$)/,
    /^(zeig|liste|such|find|hol)\s+(mir\s+)?(die|den|das|alle)/i,
  ];

  return safePatterns.some((p) => p.test(prompt.trim()));
}
