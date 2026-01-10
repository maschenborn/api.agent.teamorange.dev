/**
 * Agent Registry - Loads agent configurations from filesystem
 *
 * Agents are defined in the /agents directory:
 *   agents/
 *     crm/
 *       CLAUDE.md      # System prompt
 *       config.json    # Metadata (id, name, description, needsDocker, env)
 *       .mcp.json      # Optional: MCP server configuration
 *
 * Email an xyz@agent.teamorange.dev → Agent "xyz" wird verwendet
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// agents/ folder is at project root, not in src/
const AGENTS_DIR = path.resolve(__dirname, '../../agents');

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface AgentConfig {
  /** Unique identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this agent does */
  description: string;
  /** System prompt for Claude Code (loaded from CLAUDE.md) */
  systemPrompt: string;
  /** Whether this agent needs Docker execution (vs simple response) */
  needsDocker: boolean;
  /** Environment variables to pass to the container */
  env?: Record<string, string>;
  /** MCP configuration (loaded from .mcp.json) */
  mcpConfig?: McpConfig;
  /** Path to agent directory */
  agentDir: string;
  /**
   * Allowed sender email addresses (whitelist)
   * Default: ["m.aschenborn@teamorange.de"]
   * Can be exact emails or domain patterns like "*@teamorange.de"
   */
  allowedSenders: string[];
}

// In-memory cache of loaded agents
let agentCache: Record<string, AgentConfig> = {};
let defaultAgentCache: AgentConfig | null = null;
let isInitialized = false;

/**
 * Load a single agent configuration from its directory
 */
function loadAgentFromDir(agentDir: string): AgentConfig | null {
  const agentId = path.basename(agentDir);

  try {
    // Load config.json (required)
    const configPath = path.join(agentDir, 'config.json');
    if (!fs.existsSync(configPath)) {
      logger.warn({ agentId, configPath }, 'Agent config.json not found');
      return null;
    }
    const configRaw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configRaw);

    // Load CLAUDE.md as systemPrompt (required)
    const claudeMdPath = path.join(agentDir, 'CLAUDE.md');
    if (!fs.existsSync(claudeMdPath)) {
      logger.warn({ agentId, claudeMdPath }, 'Agent CLAUDE.md not found');
      return null;
    }
    const systemPrompt = fs.readFileSync(claudeMdPath, 'utf-8');

    // Load .mcp.json (optional)
    let mcpConfig: McpConfig | undefined;
    const mcpPath = path.join(agentDir, '.mcp.json');
    if (fs.existsSync(mcpPath)) {
      try {
        const mcpRaw = fs.readFileSync(mcpPath, 'utf-8');
        mcpConfig = JSON.parse(mcpRaw);
      } catch (err) {
        logger.warn({ agentId, mcpPath, error: err }, 'Failed to parse .mcp.json');
      }
    }

    // Default allowed sender - can be extended per agent
    const defaultAllowedSenders = ['m.aschenborn@teamorange.de'];

    const agentConfig: AgentConfig = {
      id: config.id || agentId,
      name: config.name || agentId,
      description: config.description || '',
      systemPrompt,
      needsDocker: config.needsDocker ?? true,
      env: config.env,
      mcpConfig,
      agentDir,
      allowedSenders: config.allowedSenders || defaultAllowedSenders,
    };

    logger.debug({ agentId, hasMcp: !!mcpConfig }, 'Loaded agent configuration');
    return agentConfig;
  } catch (err) {
    logger.error({ agentId, error: err }, 'Failed to load agent configuration');
    return null;
  }
}

/**
 * Initialize the agent registry by loading all agents from filesystem
 */
export function initializeAgentRegistry(): void {
  if (isInitialized) {
    return;
  }

  agentCache = {};
  defaultAgentCache = null;

  if (!fs.existsSync(AGENTS_DIR)) {
    logger.warn({ agentsDir: AGENTS_DIR }, 'Agents directory not found');
    isInitialized = true;
    return;
  }

  const entries = fs.readdirSync(AGENTS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const agentDir = path.join(AGENTS_DIR, entry.name);
    const agent = loadAgentFromDir(agentDir);

    if (agent) {
      agentCache[agent.id] = agent;

      // Special handling for default agent
      if (agent.id === 'default') {
        defaultAgentCache = agent;
      }
    }
  }

  logger.info(
    { agentCount: Object.keys(agentCache).length, agents: Object.keys(agentCache) },
    'Agent registry initialized'
  );

  isInitialized = true;
}

/**
 * Get the default agent (fallback for unknown addresses)
 */
function getDefaultAgent(): AgentConfig {
  if (!isInitialized) {
    initializeAgentRegistry();
  }

  if (defaultAgentCache) {
    return defaultAgentCache;
  }

  // Fallback if no default agent is defined
  return {
    id: 'default',
    name: 'Default Agent',
    description: 'Standard-Agent fuer unbekannte Adressen',
    systemPrompt: 'Du bist ein Hilfs-Agent. Beantworte die Anfrage so gut wie moeglich auf Deutsch.',
    needsDocker: true,
    agentDir: '',
    allowedSenders: ['m.aschenborn@teamorange.de'],
  };
}

/**
 * Get agent configuration based on recipient email address
 * @param recipientEmail - e.g. "test@agent.teamorange.dev"
 * @returns Agent configuration
 */
export function getAgentForEmail(recipientEmail: string): AgentConfig {
  if (!isInitialized) {
    initializeAgentRegistry();
  }

  // Extract the local part (before @)
  const localPart = recipientEmail.split('@')[0]?.toLowerCase();

  if (!localPart) {
    return getDefaultAgent();
  }

  return agentCache[localPart] || getDefaultAgent();
}

/**
 * Get all registered agents
 */
export function getAllAgents(): AgentConfig[] {
  if (!isInitialized) {
    initializeAgentRegistry();
  }

  return Object.values(agentCache);
}

/**
 * Check if an agent exists
 */
export function hasAgent(id: string): boolean {
  if (!isInitialized) {
    initializeAgentRegistry();
  }

  return id in agentCache;
}

/**
 * Get agent by ID
 * @param id - Agent ID (e.g. "test", "crm", "default")
 * @returns Agent configuration or undefined
 */
export function getAgentById(id: string): AgentConfig | undefined {
  if (!isInitialized) {
    initializeAgentRegistry();
  }

  if (id === 'default') {
    return getDefaultAgent();
  }

  return agentCache[id];
}

/**
 * Reload agent registry (useful for development)
 */
export function reloadAgentRegistry(): void {
  isInitialized = false;
  initializeAgentRegistry();
}

/**
 * Get path to agents directory
 */
export function getAgentsDir(): string {
  return AGENTS_DIR;
}

/**
 * Check if a sender is allowed to use an agent
 * @param sender - Email address of the sender (lowercase)
 * @param agentConfig - Agent configuration with allowedSenders
 * @returns true if sender is allowed
 */
export function isSenderAllowed(sender: string, agentConfig: AgentConfig): boolean {
  const senderLower = sender.toLowerCase();

  for (const pattern of agentConfig.allowedSenders) {
    const patternLower = pattern.toLowerCase();

    // Wildcard domain pattern: *@domain.de
    if (patternLower.startsWith('*@')) {
      const domain = patternLower.slice(2);
      if (senderLower.endsWith(`@${domain}`)) {
        return true;
      }
    }
    // Exact match
    else if (senderLower === patternLower) {
      return true;
    }
  }

  return false;
}
