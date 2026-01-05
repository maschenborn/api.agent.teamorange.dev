import type { ReceivedEmail } from '../email/types.js';
import type { AgentTask } from './types.js';
import { logger } from '../utils/logger.js';
import { randomUUID } from 'crypto';

export function parseTaskFromEmail(email: ReceivedEmail): AgentTask {
  // Extract task description from email body
  const body = email.text || stripHtml(email.html || '');

  if (!body.trim()) {
    throw new Error('Email body is empty - cannot extract task');
  }

  // Create a concise summary (first 200 chars)
  const summary = body.trim().substring(0, 200) + (body.length > 200 ? '...' : '');

  // Get the primary recipient (determines which agent handles this)
  const recipient = email.to[0] || 'unknown@agent.teamorange.dev';

  logger.info({ emailId: email.id, summary, recipient }, 'Parsed task from email');

  return {
    id: randomUUID(),
    description: body.trim(),
    summary,
    emailId: email.id,
    sender: email.from,
    recipient,
    subject: email.subject,
    messageId: email.message_id,
    createdAt: new Date(email.created_at),
  };
}

function stripHtml(html: string): string {
  return html
    // Remove script/style tags and their content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    // Replace common block elements with newlines
    .replace(/<\/?(div|p|br|hr|li|tr|td|th|h[1-6])[^>]*>/gi, '\n')
    // Remove all remaining HTML tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    // Clean up whitespace
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}
