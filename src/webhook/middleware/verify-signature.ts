import type { Request, Response, NextFunction } from 'express';
import { Resend } from 'resend';
import { config } from '../../config/index.js';
import { logger } from '../../utils/logger.js';
import { WebhookVerificationError } from '../../utils/errors.js';

const resend = new Resend(config.resendApiKey);

export async function verifyResendSignature(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const signature = req.headers['svix-signature'] as string | undefined;
  const timestamp = req.headers['svix-timestamp'] as string | undefined;
  const id = req.headers['svix-id'] as string | undefined;

  if (!signature || !timestamp || !id) {
    logger.warn('Missing webhook signature headers');
    res.status(401).json({ error: 'Missing signature headers' });
    return;
  }

  try {
    // Get raw body as string
    const payload = typeof req.body === 'string'
      ? req.body
      : JSON.stringify(req.body);

    resend.webhooks.verify({
      payload,
      headers: {
        id,
        timestamp,
        signature,
      } as any, // Resend SDK expects specific header type
      webhookSecret: config.resendWebhookSecret,
    });

    next();
  } catch (error) {
    logger.warn({ error }, 'Invalid webhook signature');
    res.status(401).json({ error: 'Invalid signature' });
  }
}
