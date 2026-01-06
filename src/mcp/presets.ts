/**
 * MCP Server Presets
 *
 * Pre-configured MCP servers that can be enabled via API.
 */

export interface McpServerPreset {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/**
 * Available MCP server presets
 */
export const MCP_PRESETS: Record<string, McpServerPreset> = {
  moco: {
    command: 'npx',
    args: ['-y', '@anthropic/moco-mcp-server'],
    env: {
      MOCO_API_KEY: '${MOCO_API_KEY}',
    },
  },
  firecrawl: {
    command: 'npx',
    args: ['-y', '@anthropic/firecrawl-mcp-server'],
    env: {
      FIRECRAWL_API_KEY: '${FIRECRAWL_API_KEY}',
    },
  },
};

/**
 * Get preset by name
 */
export function getPreset(name: string): McpServerPreset | undefined {
  return MCP_PRESETS[name];
}

/**
 * List available preset names
 */
export function listPresets(): string[] {
  return Object.keys(MCP_PRESETS);
}
