/**
 * Agent Registry - Maps email addresses to agent configurations
 *
 * Email an xyz@agent.teamorange.dev → Agent "xyz" wird verwendet
 */

export interface AgentConfig {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this agent does */
  description: string;
  /** System prompt for Claude Code */
  systemPrompt: string;
  /** Whether this agent needs Docker execution (vs simple response) */
  needsDocker: boolean;
  /** Environment variables to pass to the container */
  env?: Record<string, string>;
  /** MCP servers to enable (for future use) */
  mcpServers?: string[];
}

// Agent configurations
const agents: Record<string, AgentConfig> = {
  test: {
    id: 'test',
    name: 'Test Agent',
    description: 'Einfacher Test-Agent der mit Statistiken antwortet',
    needsDocker: true,
    systemPrompt: `Du bist ein Test-Agent für team:orange.

## Deine Aufgabe
Beantworte die Anfrage des Nutzers und füge am Ende folgende Statistiken hinzu:

- Modell: Claude (via Claude Code MAX Subscription)
- Agent-ID: test
- Zeitstempel: Aktuelles Datum/Uhrzeit
- Status: Funktioniert ✓

## Anweisungen
1. Lies die Anfrage des Nutzers
2. Antworte hilfreich und freundlich auf Deutsch
3. Füge die Statistiken am Ende hinzu
4. Halte die Antwort kurz und prägnant

## Format
Antworte im Klartext, kein Markdown.
`,
  },

  // Placeholder für zukünftige Agents
  moco: {
    id: 'moco',
    name: 'Moco CRM Agent',
    description: 'Agent mit Zugriff auf Moco CRM via MCP',
    needsDocker: true,
    mcpServers: ['moco'],
    systemPrompt: `Du bist ein Agent für Moco CRM Operationen.

## Verfügbare Tools
- Moco MCP Server für CRM-Zugriff

## Anweisungen
1. Analysiere die Anfrage
2. Führe die gewünschte Moco-Operation aus
3. Bestätige die Ausführung

## Wichtig
- Alle Inhalte auf Deutsch
- Nur Moco-relevante Anfragen bearbeiten
`,
  },
};

// Default agent for unknown addresses
const defaultAgent: AgentConfig = {
  id: 'default',
  name: 'Default Agent',
  description: 'Standard-Agent für unbekannte Adressen',
  needsDocker: true,
  systemPrompt: `Du bist ein Hilfs-Agent für team:orange.

## Deine Aufgabe
Beantworte die Anfrage des Nutzers so gut wie möglich.

## Anweisungen
1. Lies die Anfrage
2. Antworte hilfreich auf Deutsch
3. Falls du die Aufgabe nicht erledigen kannst, erkläre warum

## Hinweis
Diese Email wurde an eine unbekannte Adresse gesendet.
Für spezifische Aufgaben nutze:
- test@agent.teamorange.dev - Test & Statistiken
- moco@agent.teamorange.dev - Moco CRM Operationen
`,
};

/**
 * Get agent configuration based on recipient email address
 * @param recipientEmail - e.g. "test@agent.teamorange.dev"
 * @returns Agent configuration
 */
export function getAgentForEmail(recipientEmail: string): AgentConfig {
  // Extract the local part (before @)
  const localPart = recipientEmail.split('@')[0]?.toLowerCase();

  if (!localPart) {
    return defaultAgent;
  }

  return agents[localPart] || defaultAgent;
}

/**
 * Get all registered agents
 */
export function getAllAgents(): AgentConfig[] {
  return Object.values(agents);
}

/**
 * Check if an agent exists
 */
export function hasAgent(id: string): boolean {
  return id in agents;
}

/**
 * Get agent by ID
 * @param id - Agent ID (e.g. "test", "moco", "default")
 * @returns Agent configuration or undefined
 */
export function getAgentById(id: string): AgentConfig | undefined {
  if (id === 'default') {
    return defaultAgent;
  }
  return agents[id];
}
