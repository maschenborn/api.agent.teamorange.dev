import { Resend } from 'resend';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import type {
  ReceivedEmail,
  TaskReceivedParams,
  TaskCompletedParams,
  TaskFailedParams,
  TaskRejectedParams,
} from './types.js';
import { taskReceivedTemplate } from './templates/task-received.js';
import { taskCompletedTemplate } from './templates/task-completed.js';
import { taskFailedTemplate } from './templates/task-failed.js';
import { taskRejectedTemplate } from './templates/task-rejected.js';

export class EmailClient {
  private resend: Resend;

  constructor() {
    this.resend = new Resend(config.resendApiKey);
  }

  async getReceivedEmail(emailId: string): Promise<ReceivedEmail> {
    logger.debug({ emailId }, 'Fetching received email from Resend Receiving API');

    // Resend Receiving API endpoint (different from sending!)
    const response = await fetch(
      `https://api.resend.com/emails/receiving/${emailId}`,
      {
        headers: {
          Authorization: `Bearer ${config.resendApiKey}`,
        },
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      logger.error({ emailId, status: response.status, errorText }, 'Failed to fetch email');
      throw new Error(`Failed to fetch email ${emailId}: ${response.status} ${errorText}`);
    }

    const email = await response.json() as ReceivedEmail;
    logger.debug({ emailId, subject: email.subject, hasText: !!email.text, hasHtml: !!email.html }, 'Fetched email');

    return email;
  }

  async sendTaskReceived(params: TaskReceivedParams): Promise<string> {
    logger.info({ to: params.to }, 'Sending task received acknowledgment');

    const { data, error } = await this.resend.emails.send({
      from: config.agentEmailFrom,
      to: params.to,
      subject: `Re: ${params.originalSubject}`,
      html: taskReceivedTemplate(params),
      headers: {
        'In-Reply-To': params.originalMessageId,
        References: params.originalMessageId,
      },
    });

    if (error) {
      throw new Error(`Failed to send task received email: ${error.message}`);
    }

    logger.info({ emailId: data?.id }, 'Sent task received email');
    return data?.id ?? '';
  }

  async sendTaskCompleted(params: TaskCompletedParams): Promise<string> {
    logger.info({ to: params.to }, 'Sending task completed notification');

    const { data, error } = await this.resend.emails.send({
      from: config.agentEmailFrom,
      to: params.to,
      subject: `Re: ${params.originalSubject}`,
      html: taskCompletedTemplate(params),
      headers: {
        'In-Reply-To': params.originalMessageId,
        References: params.originalMessageId,
      },
    });

    if (error) {
      throw new Error(`Failed to send task completed email: ${error.message}`);
    }

    logger.info({ emailId: data?.id }, 'Sent task completed email');
    return data?.id ?? '';
  }

  async sendTaskFailed(params: TaskFailedParams): Promise<string> {
    logger.warn({ to: params.to, error: params.error }, 'Sending task failed notification');

    const { data, error } = await this.resend.emails.send({
      from: config.agentEmailFrom,
      to: params.to,
      subject: `Re: ${params.originalSubject}`,
      html: taskFailedTemplate(params),
      headers: {
        'In-Reply-To': params.originalMessageId,
        References: params.originalMessageId,
      },
    });

    if (error) {
      throw new Error(`Failed to send task failed email: ${error.message}`);
    }

    logger.info({ emailId: data?.id }, 'Sent task failed email');
    return data?.id ?? '';
  }

  async sendTaskRejected(params: TaskRejectedParams): Promise<string> {
    logger.info({ to: params.to, reason: params.reason }, 'Sending task rejected notification');

    const { data, error } = await this.resend.emails.send({
      from: config.agentEmailFrom,
      to: params.to,
      subject: `Re: ${params.originalSubject}`,
      html: taskRejectedTemplate({
        reason: params.reason,
        explanation: params.explanation,
        suggestion: params.suggestion,
      }),
      headers: {
        'In-Reply-To': params.originalMessageId,
        References: params.originalMessageId,
      },
    });

    if (error) {
      throw new Error(`Failed to send task rejected email: ${error.message}`);
    }

    logger.info({ emailId: data?.id }, 'Sent task rejected email');
    return data?.id ?? '';
  }
}

// Singleton instance
export const emailClient = new EmailClient();
