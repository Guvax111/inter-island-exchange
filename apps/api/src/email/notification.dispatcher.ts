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
  sellerApproved: 'seller.approved',
  sellerActivated: 'seller.activated',
  sellerRejected: 'seller.rejected',
  sellerChangesRequested: 'seller.changes_requested',
  sellerSuspended: 'seller.suspended',
  productApproved: 'product.approved',
  productRejected: 'product.rejected',
  productChangesRequested: 'product.changes_requested',
  orderPlaced: 'transaction.order_placed',
  orderCancelled: 'transaction.cancelled',
  transactionUpdate: 'transaction.update',
} as const;

const SELLER_EVENTS: Record<string, 'approved' | 'rejected' | 'changes_requested' | 'activated' | 'suspended'> = {
  [EVENTS.sellerApproved]: 'approved',
  [EVENTS.sellerActivated]: 'activated',
  [EVENTS.sellerRejected]: 'rejected',
  [EVENTS.sellerChangesRequested]: 'changes_requested',
  [EVENTS.sellerSuspended]: 'suspended',
};
const PRODUCT_EVENTS: Record<string, 'approved' | 'rejected' | 'changes_requested'> = {
  [EVENTS.productApproved]: 'approved',
  [EVENTS.productRejected]: 'rejected',
  [EVENTS.productChangesRequested]: 'changes_requested',
};

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
    const to = payload as unknown as Recipient & {
      token?: string;
      notes?: string;
      productId?: string;
      productTitle?: string;
      iieId?: string;
      total?: string;
      reason?: string;
      subject?: string;
      message?: string;
      path?: string;
    };
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
      case EVENTS.orderPlaced:
        return this.email.send(templates.orderPlaced(to.email, to.firstName, to.iieId!, to.total!, `${web}/orders/${to.iieId}`));
      case EVENTS.orderCancelled:
        return this.email.send(templates.orderCancelled(to.email, to.firstName, to.iieId!, to.reason!, `${web}/orders/${to.iieId}`));
      case EVENTS.transactionUpdate:
        return this.email.send(templates.transactionUpdate(to.email, to.firstName, to.subject!, to.message!, `${web}${to.path}`));
      case EVENTS.accountSuspended:
        return this.email.send(templates.accountSuspended(to.email, to.firstName));
      default:
        if (SELLER_EVENTS[type]) {
          return this.email.send(templates.sellerDecision(to.email, to.firstName, SELLER_EVENTS[type], to.notes, `${web}/dashboard/seller`));
        }
        if (PRODUCT_EVENTS[type]) {
          return this.email.send(
            templates.productDecision(to.email, to.firstName, to.productTitle ?? 'Your product', PRODUCT_EVENTS[type], to.notes, `${web}/dashboard/seller/products/${to.productId}`),
          );
        }
        // Events without a notification are acknowledged so they do not block the queue.
        return;
    }
  }
}
