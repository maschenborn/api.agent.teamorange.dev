import type { TaskCompletedParams, DebugDump } from '../types.js';

export function taskCompletedTemplate(params: TaskCompletedParams): string {
  const { result, debugDump } = params;

  const filesSection = result.filesModified.length > 0
    ? `
      <h3>Geaenderte Dateien:</h3>
      <ul>
        ${result.filesModified.map(f => `<li><code>${escapeHtml(f)}</code></li>`).join('\n')}
      </ul>
    `
    : '';

  const commitSection = result.commitHash
    ? `<p><strong>Commit:</strong> <code>${escapeHtml(result.commitHash)}</code></p>`
    : '';

  const modelsSection = result.modelsUsed && result.modelsUsed.length > 0
    ? `<p><strong>Modelle:</strong> ${result.modelsUsed.join(', ')}</p>`
    : '';

  // Auth method: oauth = Subscription (free), api_key = Pay-as-you-go
  const authLabel = result.authMethod === 'api_key' ? 'API (kostenpflichtig)' : 'Subscription';
  const authSection = result.authMethod
    ? `<p style="font-size: 11px; color: #888;"><strong>Auth:</strong> ${authLabel}</p>`
    : '';

  // Debug dump section (only when /dump was in subject)
  const debugDumpSection = debugDump ? renderDebugDump(debugDump) : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #22c55e; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
    .summary-box { background: white; padding: 15px; border-radius: 4px; border-left: 4px solid #22c55e; margin: 15px 0; }
    code { background: #e5e7eb; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
    .footer { color: #666; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">Aufgabe erledigt</h1>
    </div>
    <div class="content">
      <p>Hallo,</p>
      <p>Ich habe deine Aufgabe erfolgreich abgeschlossen.</p>

      <div class="summary-box">
        <strong>Zusammenfassung:</strong><br>
        ${markdownToHtml(result.summary)}
      </div>

      ${filesSection}
      ${commitSection}
      ${modelsSection}
      ${authSection}

      ${result.commitHash ? '<p>Die Aenderungen wurden committed und gepusht. Du kannst sie jetzt im Repository einsehen.</p>' : ''}

      <p class="footer">
        — Claude Remote Agent<br>
        <em>Diese E-Mail wurde automatisch generiert.</em>
      </p>
    </div>
    ${debugDumpSection}
  </div>
</body>
</html>
`.trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/\n/g, '<br>');
}

/**
 * Convert basic markdown to HTML for email display
 */
function markdownToHtml(text: string): string {
  return text
    // First escape HTML entities
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    // Italic: *text* or _text_ (but not inside words)
    .replace(/(?<!\w)\*([^*]+?)\*(?!\w)/g, '<em>$1</em>')
    .replace(/(?<!\w)_([^_]+?)_(?!\w)/g, '<em>$1</em>')
    // Inline code: `code`
    .replace(/`([^`]+?)`/g, '<code>$1</code>')
    // Links: [text](url) - convert to just text with arrow and URL
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 -&gt; <a href="$2">$2</a>')
    // Horizontal rule: --- or ***
    .replace(/^---+$/gm, '<hr>')
    .replace(/^\*\*\*+$/gm, '<hr>')
    // Bullet lists: lines starting with - or *
    .replace(/^[\-\*] (.+)$/gm, '<li>$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    // Newlines to <br>
    .replace(/\n/g, '<br>');
}

/**
 * Render debug dump section for /dump command
 */
function renderDebugDump(dump: DebugDump): string {
  const agentsTable = dump.availableAgents
    .map((a) => `<tr><td><code>${escapeHtml(a.id)}</code></td><td>${escapeHtml(a.name)}</td><td><code>${escapeHtml(a.email)}</code></td></tr>`)
    .join('\n');

  const mcpList = dump.mcpServers.length > 0
    ? dump.mcpServers.map((s) => `<li><code>${escapeHtml(s)}</code></li>`).join('\n')
    : '<li><em>Keine MCP-Server konfiguriert</em></li>';

  const toolsList = dump.allowedTools.map((t) => `<code>${escapeHtml(t)}</code>`).join(', ');

  return `
    <div style="margin-top: 40px; border-top: 2px solid #ccc; padding-top: 20px;">
      <h2 style="color: #666; margin-bottom: 20px;">Debug Dump (/dump)</h2>

      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <h3 style="margin-top: 0; color: #333;">Request Info</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 4px 0; color: #666; width: 140px;">Email-ID:</td><td><code>${escapeHtml(dump.emailId)}</code></td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Von:</td><td><code>${escapeHtml(dump.sender)}</code></td></tr>
          <tr><td style="padding: 4px 0; color: #666;">An:</td><td><code>${escapeHtml(dump.recipient)}</code></td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Betreff:</td><td>${escapeHtml(dump.subject)}</td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Empfangen:</td><td>${escapeHtml(dump.receivedAt)}</td></tr>
        </table>
      </div>

      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <h3 style="margin-top: 0; color: #333;">Agent</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 4px 0; color: #666; width: 140px;">ID:</td><td><code>${escapeHtml(dump.agentId)}</code></td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Name:</td><td>${escapeHtml(dump.agentName)}</td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Beschreibung:</td><td>${escapeHtml(dump.agentDescription)}</td></tr>
        </table>
        <h4 style="margin-bottom: 8px;">System-Prompt (erste 500 Zeichen):</h4>
        <pre style="background: #e8e8e8; padding: 10px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; font-size: 11px;">${escapeHtml(dump.systemPromptPreview)}</pre>
      </div>

      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <h3 style="margin-top: 0; color: #333;">Session</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 4px 0; color: #666; width: 140px;">Session-ID:</td><td><code>${escapeHtml(dump.sessionId)}</code></td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Neue Session:</td><td>${dump.isNewSession ? 'Ja' : 'Nein (fortgesetzt)'}</td></tr>
        </table>
      </div>

      <div style="background: ${dump.guardrail.decision === 'APPROVED' ? '#e8f5e9' : '#ffebee'}; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <h3 style="margin-top: 0; color: #333;">Guardrail-Analyse</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 4px 0; color: #666; width: 140px;">Entscheidung:</td><td><strong style="color: ${dump.guardrail.decision === 'APPROVED' ? '#2e7d32' : '#c62828'};">${escapeHtml(dump.guardrail.decision)}</strong></td></tr>
          ${dump.guardrail.reason ? `<tr><td style="padding: 4px 0; color: #666;">Grund:</td><td>${escapeHtml(dump.guardrail.reason)}</td></tr>` : ''}
          <tr><td style="padding: 4px 0; color: #666;">Erklaerung:</td><td>${escapeHtml(dump.guardrail.explanation)}</td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Konfidenz:</td><td>${(dump.guardrail.confidence * 100).toFixed(0)}%</td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Methode:</td><td><code>${escapeHtml(dump.guardrail.method)}</code></td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Dauer:</td><td>${dump.guardrail.durationMs}ms</td></tr>
        </table>
      </div>

      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <h3 style="margin-top: 0; color: #333;">Execution</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr><td style="padding: 4px 0; color: #666; width: 140px;">Execution-ID:</td><td><code>${escapeHtml(dump.executionId)}</code></td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Modell:</td><td><code>${escapeHtml(dump.model)}</code></td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Max Turns:</td><td>${dump.maxTurns}</td></tr>
          <tr><td style="padding: 4px 0; color: #666;">Gesamtdauer:</td><td>${dump.totalDurationMs}ms (${(dump.totalDurationMs / 1000).toFixed(1)}s)</td></tr>
        </table>
        <h4 style="margin-bottom: 8px;">Erlaubte Tools:</h4>
        <p style="margin: 0;">${toolsList}</p>
        <h4 style="margin-bottom: 8px;">Prompt:</h4>
        <pre style="background: #e8e8e8; padding: 10px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; font-size: 11px;">${escapeHtml(dump.prompt)}</pre>
      </div>

      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <h3 style="margin-top: 0; color: #333;">MCP-Server</h3>
        <ul style="margin: 0; padding-left: 20px;">
          ${mcpList}
        </ul>
      </div>

      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <h3 style="margin-top: 0; color: #333;">Verfuegbare Agents</h3>
        <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
          <thead>
            <tr style="background: #e0e0e0;">
              <th style="padding: 6px; text-align: left;">ID</th>
              <th style="padding: 6px; text-align: left;">Name</th>
              <th style="padding: 6px; text-align: left;">Email</th>
            </tr>
          </thead>
          <tbody>
            ${agentsTable}
          </tbody>
        </table>
      </div>

      ${dump.rawOutput ? `
      <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
        <h3 style="margin-top: 0; color: #333;">Raw Output (letzte 2000 Zeichen)</h3>
        <pre style="background: #1e1e1e; color: #d4d4d4; padding: 10px; border-radius: 4px; overflow-x: auto; white-space: pre-wrap; font-size: 10px; max-height: 400px; overflow-y: auto;">${escapeHtml(dump.rawOutput)}</pre>
      </div>
      ` : ''}
    </div>
  `;
}
