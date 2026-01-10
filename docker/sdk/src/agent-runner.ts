/**
 * Agent Runner - Entry Point für Claude Agent SDK Container
 *
 * Liest Task-Konfiguration aus Environment/stdin,
 * führt Agent mit SDK aus, gibt Ergebnis auf stdout aus.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync } from "fs";
import { spawn, type ChildProcess } from "child_process";

// MCP Server Konfiguration
interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

interface McpJsonFormat {
  mcpServers: Record<string, McpServerConfig>;
}

// Task-Konfiguration aus Environment
interface TaskConfig {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTurns?: number;
  sessionId?: string;
  allowedTools?: string[];
  agentId?: string;
  mcpConfigPath?: string; // Pfad zur .mcp.json
}

// Tool Call Tracking
interface ToolCall {
  tool: string;
  input: string;
  output?: string;
}

// Ergebnis-Struktur
interface TaskResult {
  success: boolean;
  sessionId: string;
  output: string;
  structuredOutput?: unknown;
  cost?: number;
  turns?: number;
  error?: string;
  toolCalls?: ToolCall[]; // Bash commands executed
}

/**
 * Lade MCP-Konfiguration aus Datei
 */
function loadMcpConfig(configPath?: string): McpJsonFormat | null {
  // Standard-Pfade pruefen
  const paths = [
    configPath,
    "/home/agent/.claude/.mcp.json",
    "/home/agent/.mcp.json",
    ".mcp.json"
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (existsSync(p)) {
      try {
        const content = readFileSync(p, "utf-8");
        const config = JSON.parse(content) as McpJsonFormat;
        console.error(`[MCP] Loaded config from ${p}: ${Object.keys(config.mcpServers || {}).join(", ")}`);
        return config;
      } catch (e) {
        console.error(`[MCP] Failed to parse ${p}: ${e}`);
      }
    }
  }

  return null;
}

/**
 * Resolve ${VAR} placeholders in env
 */
function resolveEnvVars(env: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!env) return undefined;

  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value.startsWith("${") && value.endsWith("}")) {
      const varName = value.slice(2, -1);
      resolved[key] = process.env[varName] || "";
    } else {
      resolved[key] = value;
    }
  }
  return resolved;
}

/**
 * Starte MCP-Server als Child Processes
 */
function startMcpServers(mcpConfig: McpJsonFormat): Map<string, ChildProcess> {
  const processes = new Map<string, ChildProcess>();

  for (const [name, config] of Object.entries(mcpConfig.mcpServers || {})) {
    try {
      const env = {
        ...process.env,
        ...resolveEnvVars(config.env)
      };

      const proc = spawn(config.command, config.args, {
        env,
        stdio: ["pipe", "pipe", "pipe"]
      });

      proc.on("error", (err) => {
        console.error(`[MCP] Server ${name} error: ${err.message}`);
      });

      processes.set(name, proc);
      console.error(`[MCP] Started server: ${name} (${config.command})`);
    } catch (e) {
      console.error(`[MCP] Failed to start ${name}: ${e}`);
    }
  }

  return processes;
}

/**
 * Stoppe alle MCP-Server
 */
function stopMcpServers(processes: Map<string, ChildProcess>): void {
  for (const [name, proc] of processes) {
    try {
      proc.kill("SIGTERM");
      console.error(`[MCP] Stopped server: ${name}`);
    } catch {
      // Ignore
    }
  }
}

async function runAgent(): Promise<void> {
  // Task aus Environment lesen
  const taskJson = process.env.AGENT_TASK;
  if (!taskJson) {
    console.error(JSON.stringify({
      success: false,
      error: "AGENT_TASK environment variable not set"
    }));
    process.exit(1);
  }

  let task: TaskConfig;
  try {
    task = JSON.parse(taskJson);
  } catch (e) {
    console.error(JSON.stringify({
      success: false,
      error: `Invalid AGENT_TASK JSON: ${e}`
    }));
    process.exit(1);
  }

  // Validierung
  if (!task.prompt) {
    console.error(JSON.stringify({
      success: false,
      error: "Task prompt is required"
    }));
    process.exit(1);
  }

  let result: TaskResult = {
    success: false,
    sessionId: "",
    output: ""
  };

  // Track tool calls for debugging
  const toolCalls: ToolCall[] = [];
  const pendingToolCalls = new Map<string, ToolCall>();

  // MCP-Konfiguration laden
  const mcpConfig = loadMcpConfig(task.mcpConfigPath);
  const mcpServers: Record<string, McpServerConfig> = {};

  if (mcpConfig?.mcpServers) {
    // Env-Variablen aufloesen
    for (const [name, config] of Object.entries(mcpConfig.mcpServers)) {
      mcpServers[name] = {
        command: config.command,
        args: config.args,
        env: resolveEnvVars(config.env)
      };
    }
    console.error(`[MCP] Passing ${Object.keys(mcpServers).length} server(s) to SDK`);
  }

  try {
    // SDK Query ausführen
    for await (const message of query({
      prompt: task.prompt,
      options: {
        model: task.model || "sonnet",
        maxTurns: task.maxTurns || 50,
        allowedTools: task.allowedTools || ["Read", "Glob", "Grep", "Bash", "mcp__*"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        resume: task.sessionId,
        systemPrompt: task.systemPrompt ? {
          type: "preset",
          preset: "claude_code",
          append: task.systemPrompt
        } : undefined,
        mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined
      }
    })) {
      // Session ID bei Init erfassen
      if (message.type === "system" && message.subtype === "init") {
        result.sessionId = message.session_id;
      }

      // Finales Ergebnis
      if (message.type === "result") {
        if (message.subtype === "success") {
          result.success = true;
          result.output = message.result;
          result.structuredOutput = message.structured_output;
          result.cost = message.total_cost_usd;
          result.turns = message.num_turns;
        } else {
          result.success = false;
          result.error = `Agent failed: ${message.subtype}`;
          if ("errors" in message) {
            result.error += ` - ${message.errors.join(", ")}`;
          }
        }
      }

      // Assistant-Nachrichten: Tool-Calls erfassen
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if ("text" in block) {
            // Text-Output sammeln
            if (!result.output) {
              result.output = block.text;
            }
          }
          // Tool use blocks - capture Bash commands
          if (block.type === "tool_use") {
            const toolName = block.name;
            const toolInput = typeof block.input === "object"
              ? JSON.stringify(block.input)
              : String(block.input);

            // Only track Bash commands (where the curl calls happen)
            if (toolName === "Bash") {
              const tc: ToolCall = {
                tool: toolName,
                input: toolInput
              };
              pendingToolCalls.set(block.id, tc);
            }
          }
        }
      }

      // User messages contain tool results
      if (message.type === "user") {
        for (const block of message.message.content) {
          if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
            const pending = pendingToolCalls.get(block.tool_use_id);
            if (pending) {
              // Extract output (first 500 chars to avoid huge logs)
              let output = "";
              if (Array.isArray(block.content)) {
                for (const c of block.content) {
                  if ("text" in c) {
                    output += c.text;
                  }
                }
              }
              pending.output = output.slice(0, 500);
              toolCalls.push(pending);
              pendingToolCalls.delete(block.tool_use_id);
            }
          }
        }
      }
    }

    // Add tool calls to result for debugging
    if (toolCalls.length > 0) {
      result.toolCalls = toolCalls;
    }

    // Ergebnis auf stdout
    console.log(JSON.stringify(result));

  } catch (error) {
    result.success = false;
    result.error = error instanceof Error ? error.message : String(error);
    console.log(JSON.stringify(result));
    process.exit(1);
  }
}

// Start
runAgent().catch((error) => {
  console.error(JSON.stringify({
    success: false,
    error: error instanceof Error ? error.message : String(error)
  }));
  process.exit(1);
});
