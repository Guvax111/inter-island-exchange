import { Injectable } from '@nestjs/common';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Tx } from '../db/db';
import { sellerProfiles, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import type { RequestMeta } from '../common/request';

/**
 * Moves an account forward once its prerequisites are met:
 *   onboarding submitted + email unverified  -> PENDING_VERIFICATION
 *   onboarding submitted + email verified    -> ACTIVE, and any seller profile -> UNDER_REVIEW
 * Accounts in UNDER_REVIEW, SUSPENDED, REJECTED or CLOSED are never moved by this service.
 */
@Injectable()
export class AccountLifecycleService {
  constructor(private readonly audit: AuditService) {}

  async advance(tx: Tx, userId: string, meta: Partial<RequestMeta>): Promise<void> {
    const [user] = await tx.select().from(users).where(eq(users.id, userId)).for('update');
    if (!user || !user.onboardingSubmittedAt) return;
    if (!['DRAFT', 'PENDING_VERIFICATION'].includes(user.status)) return;

    const next = user.emailVerifiedAt ? 'ACTIVE' : 'PENDING_VERIFICATION';
    if (next !== user.status) {
      await tx.update(users).set({ status: next, updatedAt: new Date() }).where(eq(users.id, userId));
      await this.audit.record(tx, meta, {
        action: 'user.status_changed',
        entityType: 'user',
        entityId: userId,
        before: { status: user.status },
        after: { status: next },
      });
    }

    const sellerNext = user.emailVerifiedAt ? 'UNDER_REVIEW' : 'PENDING_VERIFICATION';
    const moved = await tx
      .update(sellerProfiles)
      .set({ status: sellerNext, updatedAt: new Date() })
      .where(
        and(
          eq(sellerProfiles.userId, userId),
          inArray(sellerProfiles.status, ['DRAFT', 'PENDING_VERIFICATION']),
          ne(sellerProfiles.status, sellerNext),
        ),
      )
      .returning({ id: sellerProfiles.id });
    for (const row of moved) {
      await this.audit.record(tx, meta, {
        action: 'seller.status_changed',
        entityType: 'seller_profile',
        entityId: row.id,
        after: { status: sellerNext },
      });
    }
  }
}
