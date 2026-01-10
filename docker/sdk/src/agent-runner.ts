/**
 * Agent Runner - Entry Point für Claude Agent SDK Container
 *
 * Liest Task-Konfiguration aus Environment/stdin,
 * führt Agent mit SDK aus, gibt Ergebnis auf stdout aus.
 */

import { query } from "@anthropic-ai/claude-agent-sdk";

// Task-Konfiguration aus Environment
interface TaskConfig {
  prompt: string;
  systemPrompt?: string;
  model?: string;
  maxTurns?: number;
  sessionId?: string;
  allowedTools?: string[];
  agentId?: string;
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

  try {
    // SDK Query ausführen
    for await (const message of query({
      prompt: task.prompt,
      options: {
        model: task.model || "sonnet",
        maxTurns: task.maxTurns || 50,
        allowedTools: task.allowedTools || ["Read", "Glob", "Grep", "Bash"],
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        resume: task.sessionId,
        systemPrompt: task.systemPrompt ? {
          type: "preset",
          preset: "claude_code",
          append: task.systemPrompt
        } : undefined
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

      // Assistant-Nachrichten loggen (für Debugging)
      if (message.type === "assistant") {
        for (const block of message.message.content) {
          if ("text" in block) {
            // Text-Output sammeln
            if (!result.output) {
              result.output = block.text;
            }
          }
        }
      }
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
