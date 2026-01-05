export class AppError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode: number = 500
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class EmailProcessingError extends AppError {
  constructor(message: string, public emailId?: string) {
    super(message, 'EMAIL_PROCESSING_ERROR', 500);
    this.name = 'EmailProcessingError';
  }
}

export class AgentExecutionError extends AppError {
  constructor(message: string, public taskId?: string) {
    super(message, 'AGENT_EXECUTION_ERROR', 500);
    this.name = 'AgentExecutionError';
  }
}

export class WebhookVerificationError extends AppError {
  constructor(message: string = 'Invalid webhook signature') {
    super(message, 'WEBHOOK_VERIFICATION_ERROR', 401);
    this.name = 'WebhookVerificationError';
  }
}
