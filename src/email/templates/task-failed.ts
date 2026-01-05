import type { TaskFailedParams } from '../types.js';

export function taskFailedTemplate(params: TaskFailedParams): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #ef4444; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
    .error-box { background: white; padding: 15px; border-radius: 4px; border-left: 4px solid #ef4444; margin: 15px 0; }
    code { background: #e5e7eb; padding: 2px 6px; border-radius: 3px; font-family: monospace; }
    .footer { color: #666; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">Aufgabe fehlgeschlagen</h1>
    </div>
    <div class="content">
      <p>Hallo,</p>
      <p>Leider konnte ich deine Aufgabe nicht erfolgreich abschließen.</p>

      <div class="error-box">
        <strong>Fehler:</strong><br>
        <code>${escapeHtml(params.error)}</code>
      </div>

      <p>Du kannst es erneut versuchen oder die Anfrage präzisieren. Falls das Problem weiterhin besteht, könnte es an technischen Einschränkungen liegen.</p>

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
