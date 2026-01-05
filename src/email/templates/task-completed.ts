import type { TaskCompletedParams } from '../types.js';

export function taskCompletedTemplate(params: TaskCompletedParams): string {
  const { result } = params;

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
        ${escapeHtml(result.summary)}
      </div>

      ${filesSection}
      ${commitSection}
      ${modelsSection}

      <p>Die Änderungen wurden committed und gepusht. Du kannst sie jetzt im Repository einsehen.</p>

      <p class="footer">
        — Claude Remote Agent<br>
        <em>Diese E-Mail wurde automatisch generiert.</em>
      </p>
    </div>
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
