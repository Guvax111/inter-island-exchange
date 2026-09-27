import { Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
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

  /**
   * @param echo print messages to the log
   * @param dir  also write each message as a JSON file (used by the end-to-end tests and handy locally)
   */
  constructor(
    private readonly echo: boolean,
    private readonly dir?: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    this.sent.push(message);
    if (this.echo) this.logger.log(`To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`);
    if (this.dir) {
      await mkdir(this.dir, { recursive: true });
      const name = `${Date.now()}-${message.to.replace(/[^a-z0-9@._+-]/gi, '_')}.json`;
      await writeFile(path.join(this.dir, name), JSON.stringify(message, null, 2));
    }
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

/**
 * On a test site (e.g. the pilot rehearsal) every email says so: "[Pilot rehearsal]" before the subject and a notice
 * at the top, so nobody mistakes a test order for a real one.
 */
export class LabelledEmailProvider implements EmailProvider {
  constructor(
    private readonly inner: EmailProvider,
    private readonly label: string,
  ) {}

  get key() {
    return this.inner.key;
  }

  send(message: EmailMessage): Promise<void> {
    const notice = `${this.label}: this email is about a test order on the IIE test site. No real money has moved and no goods will be shipped.`;
    const safe = notice.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
    return this.inner.send({
      ...message,
      subject: `[${this.label}] ${message.subject}`,
      text: `${notice}\n\n${message.text}`,
      html: `<p style="background:#fff4e8;border:1px solid #f2c49b;padding:8px 12px;font-family:Arial,sans-serif;color:#9a3412">${safe}</p>\n${message.html}`,
    });
  }
}

export function withEnvironmentLabel(provider: EmailProvider, config: AppConfig): EmailProvider {
  return config.ENVIRONMENT_LABEL ? new LabelledEmailProvider(provider, config.ENVIRONMENT_LABEL) : provider;
}

export function createEmailProvider(config: AppConfig): EmailProvider {
  return config.EMAIL_PROVIDER === 'smtp' ? new SmtpEmailProvider(config) : new SandboxEmailProvider(config.APP_ENV === 'local', config.EMAIL_SANDBOX_DIR);
}
