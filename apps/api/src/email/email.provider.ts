import { Logger } from '@nestjs/common';
import nodemailer, { Transporter } from 'nodemailer';
import type { AppConfig } from '../config/config';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Provider abstraction: swap Gmail SMTP for a transactional email service without touching callers. */
export interface EmailProvider {
  readonly key: string;
  send(message: EmailMessage): Promise<void>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

/** Development/test provider: records messages in memory and prints them to the console. Refused in production. */
export class SandboxEmailProvider implements EmailProvider {
  readonly key = 'sandbox';
  readonly sent: EmailMessage[] = [];
  private readonly logger = new Logger('SandboxEmail');

  constructor(private readonly echo: boolean) {}

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    if (this.echo) this.logger.log(`To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`);
  }
}

/** SMTP provider. Initial configuration is Gmail (smtp.gmail.com:465 with an App Password). */
export class SmtpEmailProvider implements EmailProvider {
  readonly key = 'smtp';
  private readonly transport: Transporter;

  constructor(private readonly config: AppConfig) {
    this.transport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    });
  }

  async send(message: EmailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.config.EMAIL_FROM, ...message });
  }
}

export function createEmailProvider(config: AppConfig): EmailProvider {
  return config.EMAIL_PROVIDER === 'smtp' ? new SmtpEmailProvider(config) : new SandboxEmailProvider(config.APP_ENV === 'local');
}
