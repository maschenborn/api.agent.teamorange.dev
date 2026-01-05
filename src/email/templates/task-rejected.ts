import type { RejectionReason } from '../types.js';

const reasonLabels: Record<string, string> = {
  unclear: 'Aufgabe unklar',
  harmful: 'Sicherheitsbedenken',
  too_complex: 'Zu umfangreich',
};

const reasonColors: Record<string, string> = {
  unclear: '#f59e0b', // amber
  harmful: '#ef4444', // red
  too_complex: '#8b5cf6', // violet
};

interface TemplateParams {
  reason: RejectionReason;
  explanation: string;
  suggestion?: string;
}

export function taskRejectedTemplate(params: TemplateParams): string {
  const { reason, explanation, suggestion } = params;
  const label = reasonLabels[reason] || 'Ablehnung';
  const color = reasonColors[reason] || '#6b7280';

  const suggestionSection = suggestion
    ? `
      <div style="background: #fef3c7; padding: 15px; border-radius: 4px; margin-top: 15px;">
        <strong>Vorschlag:</strong><br>
        ${escapeHtml(suggestion)}
      </div>
    `
    : '';

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${color}; color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; }
    .reason-box { background: white; padding: 15px; border-radius: 4px; border-left: 4px solid ${color}; margin: 15px 0; }
    .footer { color: #666; font-size: 12px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">${label}</h1>
    </div>
    <div class="content">
      <p>Hallo,</p>
      <p>Ich konnte deine Aufgabe nicht annehmen. Hier ist der Grund:</p>

      <div class="reason-box">
        <strong>Begr&uuml;ndung:</strong><br>
        ${escapeHtml(explanation)}
      </div>

      ${suggestionSection}

      <p>Bitte formuliere deine Anfrage neu und sende sie erneut. Ich helfe gerne, wenn die Aufgabe klarer ist.</p>

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
