import { Router, type Request, type Response } from 'express';
import type { ResendEmailReceivedEvent, RejectionReason } from '../../email/types.js';
import { emailClient } from '../../email/client.js';
import { parseTaskFromEmail } from '../../agent/task-parser.js';
import { executeAgentTask } from '../../agent/executor.js';
import { analyzeTaskSafety } from '../../agent/safety-analyzer.js';
import { logger } from '../../utils/logger.js';

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
  logger.info({ emailId, from: event.data.from, subject: event.data.subject, hasText: !!event.data.text, hasHtml: !!event.data.html }, 'Received email webhook');

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

    // 3. Safety analysis (before YOLO execution)
    logger.info({ emailId, taskId: task.id }, 'Running safety analysis');
    const safetyResult = await analyzeTaskSafety(task.description);

    if (!safetyResult.approved) {
      logger.warn(
        { emailId, taskId: task.id, reason: safetyResult.reason, explanation: safetyResult.explanation },
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

    logger.info({ emailId, taskId: task.id }, 'Safety analysis passed');

    // 4. Send acknowledgment (only after safety check passes)
    logger.info({ emailId, taskId: task.id }, 'Sending task received acknowledgment');
    await emailClient.sendTaskReceived({
      to: fullEmail.from,
      taskSummary: task.summary,
      originalSubject: fullEmail.subject,
      originalMessageId: fullEmail.message_id,
    });

    // 5. Execute agent in Docker container
    logger.info({ emailId, taskId: task.id }, 'Executing agent task');
    const result = await executeAgentTask(task);

    // 6. Send results
    if (result.success) {
      logger.info({ emailId, taskId: task.id }, 'Task completed successfully');
      await emailClient.sendTaskCompleted({
        to: fullEmail.from,
        taskSummary: task.summary,
        result: {
          success: result.success,
          summary: result.summary,
          filesModified: result.filesModified,
          commitHash: result.commitHash,
        },
        originalSubject: fullEmail.subject,
        originalMessageId: fullEmail.message_id,
      });
    } else {
      logger.warn({ emailId, taskId: task.id, error: result.error }, 'Task failed');
      await emailClient.sendTaskFailed({
        to: fullEmail.from,
        error: result.error || result.summary,
        originalSubject: fullEmail.subject,
        originalMessageId: fullEmail.message_id,
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
