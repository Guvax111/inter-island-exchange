import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { EMAIL_PROVIDER, EmailProvider } from './email.provider';
import { templates } from './templates';

/** Outbox event types that produce notifications. */
export const EVENTS = {
  emailVerificationRequested: 'auth.email_verification_requested',
  registrationAttempted: 'auth.registration_attempted',
  passwordResetRequested: 'auth.password_reset_requested',
  passwordChanged: 'auth.password_changed',
  accountSuspended: 'user.suspended',
} as const;

interface Recipient {
  email: string;
  firstName: string;
}

/** Maps domain events to notifications. In-app and SMS channels are added in Phase 3. */
@Injectable()
export class NotificationDispatcher {
  constructor(
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async dispatch(type: string, payload: Record<string, unknown>): Promise<void> {
    const to = payload as unknown as Recipient & { token?: string };
    const web = this.config.WEB_BASE_URL.replace(/\/$/, '');
    switch (type) {
      case EVENTS.emailVerificationRequested:
        return this.email.send(templates.verifyEmail(to.email, to.firstName, `${web}/verify-email?token=${encodeURIComponent(to.token!)}`));
      case EVENTS.registrationAttempted:
        return this.email.send(templates.registrationAttempt(to.email, to.firstName, `${web}/login`, `${web}/forgot-password`));
      case EVENTS.passwordResetRequested:
        return this.email.send(templates.passwordReset(to.email, to.firstName, `${web}/reset-password?token=${encodeURIComponent(to.token!)}`));
      case EVENTS.passwordChanged:
        return this.email.send(templates.passwordChanged(to.email, to.firstName));
      case EVENTS.accountSuspended:
        return this.email.send(templates.accountSuspended(to.email, to.firstName));
      default:
        // Events without a notification are acknowledged so they do not block the queue.
        return;
    }
  }
}
