import { Router, type Request, type Response } from 'express';
import type { ResendEmailReceivedEvent, RejectionReason } from '../../email/types.js';
import { emailClient } from '../../email/client.js';
import { parseTaskFromEmail } from '../../agent/task-parser.js';
import { executeAgentTask } from '../../agent/executor.js';
import { analyzeTaskSafety } from '../../agent/safety-analyzer.js';
import { logger } from '../../utils/logger.js';
import { getOrCreateSession } from '../../session/index.js';
import { getAgentForEmail } from '../../agents/registry.js';

export const emailWebhookRouter = Router();

emailWebhookRouter.post('/', async (req: Request, res: Response) => {
  let event: ResendEmailReceivedEvent;

  try {
    event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (error) {
    logger.error({ error }, 'Failed to parse webhook payload');
    res.status(400).json({ error: 'Invalid JSON payload' });
    return;
  }

  // Debug: Log full payload
  logger.info({ payload: JSON.stringify(event).slice(0, 2000) }, 'Full webhook payload (truncated)');

  // Only process email.received events
  if (event.type !== 'email.received') {
    logger.debug({ type: event.type }, 'Ignoring non-email.received event');
    res.status(200).json({ status: 'ignored', reason: `event type: ${event.type}` });
    return;
  }

  const emailId = event.data.email_id;
  const fromAddress = event.data.from.toLowerCase();

  logger.info({ emailId, from: fromAddress, subject: event.data.subject, hasText: !!event.data.text, hasHtml: !!event.data.html }, 'Received email webhook');

  // LOOP PROTECTION: Ignore emails from our own domain to prevent infinite loops
  if (fromAddress.includes('@agent.teamorange.dev')) {
    logger.warn({ emailId, from: fromAddress }, 'Ignoring email from own domain (loop protection)');
    res.status(200).json({ status: 'ignored', reason: 'loop protection - email from own domain' });
    return;
  }

  // SENDER WHITELIST: Only process emails from @teamorange.de
  if (!fromAddress.endsWith('@teamorange.de')) {
    logger.warn({ emailId, from: fromAddress }, 'Ignoring email from non-whitelisted domain');
    res.status(200).json({ status: 'ignored', reason: 'sender not whitelisted - only @teamorange.de allowed' });
    return;
  }

  // Acknowledge webhook immediately
  res.status(200).json({ status: 'processing', emailId });

  // Process asynchronously
  processEmailTask(event).catch((error) => {
    logger.error({ error, emailId }, 'Failed to process email task');
  });
});

async function processEmailTask(event: ResendEmailReceivedEvent): Promise<void> {
  const emailId = event.data.email_id;
  const emailData = event.data;

  try {
    // 1. Fetch full email content via Resend Receiving API
    // (webhook only contains metadata, not body)
    logger.info({ emailId }, 'Fetching full email content from Resend Receiving API');
    const fullEmail = await emailClient.getReceivedEmail(emailId);

    logger.info({ emailId, hasText: !!fullEmail.text, hasHtml: !!fullEmail.html, textPreview: fullEmail.text?.slice(0, 100) }, 'Fetched email content');

    // 2. Parse task from email
    logger.info({ emailId }, 'Parsing task from email');
    const task = parseTaskFromEmail(fullEmail);

    // 3. Get or create session for this email thread
    const agentConfig = getAgentForEmail(task.recipient);
    const inReplyTo = fullEmail.headers?.['in-reply-to'] || fullEmail.headers?.['In-Reply-To'];

    logger.info({ emailId, agentId: agentConfig.id, inReplyTo, messageId: fullEmail.message_id }, 'Getting/creating session');

    const { session, isNew } = await getOrCreateSession({
      agentId: agentConfig.id,
      messageId: fullEmail.message_id,
      inReplyTo,
      subject: fullEmail.subject,
      sender: fullEmail.from,
    });

    logger.info(
      { emailId, sessionId: session.id, isNew, threadLength: session.thread.messageIds.length },
      isNew ? 'Created new session' : 'Continuing existing session'
    );

    // Add session ID to task
    task.sessionId = session.id;

    // 4. Safety analysis (before YOLO execution)
    logger.info({ emailId, taskId: task.id, sessionId: session.id }, 'Running safety analysis');
    const safetyResult = await analyzeTaskSafety(task.description);

    if (!safetyResult.approved) {
      logger.warn(
        { emailId, taskId: task.id, sessionId: session.id, reason: safetyResult.reason, explanation: safetyResult.explanation },
        'Task rejected by safety analysis'
      );

      await emailClient.sendTaskRejected({
        to: fullEmail.from,
        reason: safetyResult.reason as RejectionReason,
        explanation: safetyResult.explanation,
        suggestion: safetyResult.suggestedClarification,
        originalSubject: fullEmail.subject,
        originalMessageId: fullEmail.message_id,
      });

      return; // Stop processing - don't execute rejected tasks
    }

    logger.info({ emailId, taskId: task.id, sessionId: session.id }, 'Safety analysis passed');

    // 5. Send acknowledgment (only after safety check passes)
    logger.info({ emailId, taskId: task.id, sessionId: session.id }, 'Sending task received acknowledgment');
    await emailClient.sendTaskReceived({
      to: fullEmail.from,
      taskSummary: task.summary,
      originalSubject: fullEmail.subject,
      originalMessageId: fullEmail.message_id,
      sessionId: session.id,
    });

    // 6. Execute agent in Docker container
    logger.info({ emailId, taskId: task.id, sessionId: session.id }, 'Executing agent task');
    const result = await executeAgentTask(task);

    // 7. Send results
    if (result.success) {
      logger.info({ emailId, taskId: task.id, sessionId: session.id }, 'Task completed successfully');
      await emailClient.sendTaskCompleted({
        to: fullEmail.from,
        taskSummary: task.summary,
        result: {
          success: result.success,
          summary: result.summary,
          filesModified: result.filesModified,
          commitHash: result.commitHash,
          modelsUsed: result.modelsUsed,
        },
        originalSubject: fullEmail.subject,
        originalMessageId: fullEmail.message_id,
        sessionId: session.id,
      });
    } else {
      logger.warn({ emailId, taskId: task.id, sessionId: session.id, error: result.error }, 'Task failed');
      await emailClient.sendTaskFailed({
        to: fullEmail.from,
        error: result.error || result.summary,
        originalSubject: fullEmail.subject,
        originalMessageId: fullEmail.message_id,
        sessionId: session.id,
      });
    }
  } catch (error) {
    logger.error({ error, emailId }, 'Task execution failed');

    // Send failure notification
    try {
      await emailClient.sendTaskFailed({
        to: emailData.from,
        error: error instanceof Error ? error.message : 'Unknown error',
        originalSubject: emailData.subject,
        originalMessageId: emailData.message_id,
      });
    } catch (sendError) {
      logger.error({ sendError, emailId }, 'Failed to send failure notification');
    }
  }
}
