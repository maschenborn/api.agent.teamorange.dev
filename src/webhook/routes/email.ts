import { Router, type Request, type Response } from 'express';
import { randomBytes } from 'crypto';
import type { ResendEmailReceivedEvent, RejectionReason, DebugDump } from '../../email/types.js';
import { emailClient } from '../../email/client.js';
import { parseTaskFromEmail } from '../../agent/task-parser.js';
import { executeTask } from '../../execution/unified-executor.js';
import { analyzeRequest, type GuardrailResult, type BlockReason } from '../../guardrail/index.js';
import { logger } from '../../utils/logger.js';
import { getOrCreateSession, hasClaudeSession } from '../../session/index.js';
import { getAgentForEmail, getAllAgents, isSenderAllowed } from '../../agents/registry.js';
import { config } from '../../config/index.js';
import type { ExecutionRequest } from '../../execution/types.js';

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

  // Get the recipient (first "to" address)
  const recipient = event.data.to?.[0]?.toLowerCase() || '';

  // Get agent config for this recipient
  const agentConfig = getAgentForEmail(recipient);

  // PER-AGENT SENDER WHITELIST: Check if sender is allowed for this agent
  if (!isSenderAllowed(fromAddress, agentConfig)) {
    logger.warn(
      { emailId, from: fromAddress, agentId: agentConfig.id, allowedSenders: agentConfig.allowedSenders },
      'Ignoring email from non-whitelisted sender'
    );
    res.status(200).json({
      status: 'ignored',
      reason: `sender not whitelisted for agent '${agentConfig.id}'`,
    });
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
  const startTime = Date.now();

  // Check if /dump or /debug is requested
  const subjectLower = event.data.subject.toLowerCase();
  const isDumpRequested = subjectLower.includes('/dump') || subjectLower.includes('/debug');

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

    // 4. Guardrail analysis (before execution)
    logger.info({ emailId, taskId: task.id, sessionId: session.id }, 'Running guardrail analysis');
    const guardrailResult = await analyzeRequest(task.description);

    logger.info(
      {
        emailId,
        taskId: task.id,
        sessionId: session.id,
        decision: guardrailResult.decision,
        reason: guardrailResult.reason,
        confidence: guardrailResult.confidence,
        method: guardrailResult.analysisMethod,
        durationMs: guardrailResult.durationMs,
      },
      'Guardrail analysis completed'
    );

    if (guardrailResult.decision === 'BLOCKED') {
      logger.warn(
        { emailId, taskId: task.id, sessionId: session.id, reason: guardrailResult.reason, explanation: guardrailResult.explanation },
        'Task rejected by guardrail'
      );

      // Map BlockReason to RejectionReason for email
      const mapBlockReasonToRejection = (reason?: BlockReason): RejectionReason => {
        switch (reason) {
          case 'UNCLEAR':
            return 'unclear';
          case 'COMPETENCE_EXCEEDED':
            return 'too_complex';
          default:
            return 'harmful'; // DESTRUCTIVE, PROMPT_INJECTION, FINANCIAL_RISK, SECURITY_RISK, OTHER
        }
      };

      await emailClient.sendTaskRejected({
        to: fullEmail.from,
        reason: mapBlockReasonToRejection(guardrailResult.reason),
        explanation: guardrailResult.explanation,
        originalSubject: fullEmail.subject,
        originalMessageId: fullEmail.message_id,
      });

      return; // Stop processing - don't execute rejected tasks
    }

    // Handle ESCALATE as a soft-block for now (future: notify admin)
    if (guardrailResult.decision === 'ESCALATE') {
      logger.warn(
        { emailId, taskId: task.id, sessionId: session.id, explanation: guardrailResult.explanation },
        'Task requires escalation - blocking for safety'
      );

      await emailClient.sendTaskRejected({
        to: fullEmail.from,
        reason: 'too_complex',
        explanation: guardrailResult.explanation + ' Diese Anfrage erfordert manuelle Prüfung.',
        originalSubject: fullEmail.subject,
        originalMessageId: fullEmail.message_id,
      });

      return;
    }

    logger.info({ emailId, taskId: task.id, sessionId: session.id }, 'Guardrail analysis passed');

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

    // Check if we should resume an existing Claude session
    const useResume = await hasClaudeSession(agentConfig.id, session.id);

    // Build execution request
    const executionRequest: ExecutionRequest = {
      executionId: randomBytes(8).toString('hex'),
      prompt: task.description,
      agentConfig,
      sessionId: session.id,
      useResume,
      isNewSession: isNew,
      resources: {
        memoryMb: config.agentMemoryMb,
        cpuCores: config.agentCpuCores,
        timeoutMs: config.agentTimeoutMs,
        maxTurns: config.maxAgentTurns,
      },
      skipSafetyCheck: true, // Already checked above
      source: 'email',
      sender: fullEmail.from,
    };

    const result = await executeTask(executionRequest);

    // 7. Send results
    if (result.success) {
      logger.info({ emailId, taskId: task.id, sessionId: session.id }, 'Task completed successfully');

      // Build debug dump if /dump was requested
      let debugDump: DebugDump | undefined;
      if (isDumpRequested) {
        const allAgents = getAllAgents();
        const mcpServers = agentConfig.mcpConfig?.mcpServers
          ? Object.keys(agentConfig.mcpConfig.mcpServers)
          : [];

        debugDump = {
          // Request info
          emailId,
          sender: fullEmail.from,
          recipient: task.recipient,
          subject: fullEmail.subject,
          receivedAt: new Date(startTime).toISOString(),

          // Agent config
          agentId: agentConfig.id,
          agentName: agentConfig.name,
          agentDescription: agentConfig.description,
          systemPromptPreview: agentConfig.systemPrompt.slice(0, 500),

          // Session
          sessionId: session.id,
          isNewSession: isNew,

          // Guardrail
          guardrail: {
            decision: guardrailResult.decision,
            reason: guardrailResult.reason,
            explanation: guardrailResult.explanation,
            confidence: guardrailResult.confidence,
            method: guardrailResult.analysisMethod,
            durationMs: guardrailResult.durationMs,
          },

          // Execution
          prompt: task.description,
          executionId: executionRequest.executionId,
          model: agentConfig.model || config.agentDefaultModel,
          maxTurns: config.maxAgentTurns,
          allowedTools: ['Read', 'Glob', 'Grep', 'Bash', 'Write', 'Edit', 'mcp__*'],

          // MCP
          mcpServers,

          // Available agents
          availableAgents: allAgents.map((a) => ({
            id: a.id,
            name: a.name,
            email: `${a.id}@agent.teamorange.dev`,
          })),

          // Timing
          totalDurationMs: Date.now() - startTime,
          rawOutput: result.rawOutput?.slice(-10000),
        };
      }

      await emailClient.sendTaskCompleted({
        to: fullEmail.from,
        taskSummary: task.summary,
        result: {
          success: result.success,
          summary: result.summary,
          filesModified: result.filesModified,
          commitHash: result.commitHash,
          modelsUsed: result.modelsUsed,
          authMethod: result.authMethod,
        },
        originalSubject: fullEmail.subject,
        originalMessageId: fullEmail.message_id,
        sessionId: session.id,
        debugDump,
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
