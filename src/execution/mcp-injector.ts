/**
 * MCP Config Injector
 *
 * Injects MCP configuration into session's Claude home directory.
 * Claude Code reads .mcp.json from ~/.claude/ for MCP server configuration.
 */

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../utils/logger.js';
import { MCP_PRESETS, type McpServerPreset } from '../mcp/presets.js';
import type { SessionPaths } from '../session/types.js';

interface McpConfig {
  preset?: string[];
  custom?: Array<{
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

export interface McpJsonFormat {
  mcpServers: Record<
    string,
    {
      command: string;
      args: string[];
      env?: Record<string, string>;
    }
  >;
}

/**
 * Inject MCP configuration into session directory
 *
 * Creates a .mcp.json file in the session's claude-home directory
 * that Claude Code will read on startup.
 */
export async function injectMcpConfig(
  sessionPaths: SessionPaths,
  mcpConfig: McpConfig
): Promise<void> {
  const mcpJson = buildMcpJson(mcpConfig);

  if (Object.keys(mcpJson.mcpServers).length === 0) {
    logger.debug('No MCP servers to inject');
    return;
  }

  const mcpJsonPath = path.join(sessionPaths.claudeHome, '.mcp.json');

  await fs.writeFile(mcpJsonPath, JSON.stringify(mcpJson, null, 2));

  // Make readable by sandbox user
  await fs.chmod(mcpJsonPath, 0o644);

  logger.info(
    { path: mcpJsonPath, servers: Object.keys(mcpJson.mcpServers) },
    'MCP config injected'
  );
}

/**
 * Build the .mcp.json content from preset and custom configs
 */
function buildMcpJson(mcpConfig: McpConfig): McpJsonFormat {
  const mcpServers: McpJsonFormat['mcpServers'] = {};

  // Add preset servers
  if (mcpConfig.preset) {
    for (const presetName of mcpConfig.preset) {
      const preset = MCP_PRESETS[presetName];
      if (preset) {
        mcpServers[presetName] = {
          command: preset.command,
          args: preset.args,
          env: preset.env,
        };
      } else {
        logger.warn({ presetName }, 'Unknown MCP preset, skipping');
      }
    }
  }

  // Add custom servers
  if (mcpConfig.custom) {
    for (const custom of mcpConfig.custom) {
      mcpServers[custom.name] = {
        command: custom.command,
        args: custom.args || [],
        env: custom.env,
      };
    }
  }

  return { mcpServers };
}

/**
 * Inject a pre-built MCP config directly (from agent's .mcp.json)
 *
 * Unlike injectMcpConfig which builds from presets, this writes
 * an already-resolved McpJsonFormat directly.
 */
export async function injectMcpConfigDirect(
  sessionPaths: SessionPaths,
  mcpJson: McpJsonFormat
): Promise<void> {
  if (!mcpJson.mcpServers || Object.keys(mcpJson.mcpServers).length === 0) {
    logger.debug('No MCP servers to inject (direct)');
    return;
  }

  const mcpJsonPath = path.join(sessionPaths.claudeHome, '.mcp.json');

  await fs.writeFile(mcpJsonPath, JSON.stringify(mcpJson, null, 2));

  // Make readable by sandbox user
  await fs.chmod(mcpJsonPath, 0o644);

  logger.info(
    { path: mcpJsonPath, servers: Object.keys(mcpJson.mcpServers) },
    'MCP config injected (direct)'
  );
}

/**
 * Read existing MCP config from session (if any)
 */
export async function readMcpConfig(
  sessionPaths: SessionPaths
): Promise<McpJsonFormat | null> {
  const mcpJsonPath = path.join(sessionPaths.claudeHome, '.mcp.json');

  try {
    const content = await fs.readFile(mcpJsonPath, 'utf-8');
    return JSON.parse(content) as McpJsonFormat;
  } catch {
    return null;
  }
}

/**
 * Merge new MCP config with existing (if any)
 */
export async function mergeMcpConfig(
  sessionPaths: SessionPaths,
  mcpConfig: McpConfig
): Promise<void> {
  const existing = await readMcpConfig(sessionPaths);
  const newConfig = buildMcpJson(mcpConfig);

  if (existing) {
    // Merge: new config takes precedence
    const merged: McpJsonFormat = {
      mcpServers: {
        ...existing.mcpServers,
        ...newConfig.mcpServers,
      },
    };

    const mcpJsonPath = path.join(sessionPaths.claudeHome, '.mcp.json');
    await fs.writeFile(mcpJsonPath, JSON.stringify(merged, null, 2));
    await fs.chmod(mcpJsonPath, 0o644);

    logger.info(
      { servers: Object.keys(merged.mcpServers) },
      'MCP config merged'
    );
  } else {
    await injectMcpConfig(sessionPaths, mcpConfig);
  }
}
