import type { TaskReceivedParams } from '../types.js';

export function taskReceivedTemplate(params: TaskReceivedParams): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: #fa5f46; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
    .task-box { background: white; padding: 15px; border-radius: 4px; border-left: 4px solid #fa5f46; margin: 15px 0; }
    .footer { color: #666; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">Aufgabe empfangen</h1>
    </div>
    <div class="content">
      <p>Hallo,</p>
      <p>Ich habe deine Anfrage erhalten und arbeite jetzt daran:</p>

      <div class="task-box">
        <strong>Aufgabe:</strong><br>
        ${escapeHtml(params.taskSummary)}
      </div>

      <p>Ich werde dir eine weitere E-Mail senden, sobald ich fertig bin oder falls ich Rückfragen habe.</p>

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
