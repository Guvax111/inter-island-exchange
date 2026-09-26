import { HttpStatus, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { TransactionStatus } from '@iie/shared';
import type { Tx } from '../db/db';
import { transactionEvents, transactions } from '../db/schema';
import { AppError, Errors } from '../common/errors';
import { allowedActors, HOLD_STATES, SUB_STATUS_ON_ENTER, type ActorType } from './state-machine';
import { TransactionNotifier } from './transaction-notifier';

export interface Actor {
  type: ActorType;
  userId?: string | null;
}

export interface TransitionOptions {
  reason?: string;
  metadata?: Record<string, unknown>;
  /** Extra columns to set in the same update (e.g. paymentDueAt). */
  set?: Partial<typeof transactions.$inferInsert>;
  /** Refuse if another change happened since the caller read the transaction. */
  expectedVersion?: number;
}

/**
 * The only way a transaction's status changes. Runs inside the caller's database transaction:
 * locks the row, checks the move against the state machine, updates status, version and sub-statuses,
 * writes the append-only event and triggers notifications.
 */
@Injectable()
export class TransactionEngine {
  constructor(private readonly notifier: TransactionNotifier) {}

  async transition(tx: Tx, transactionId: string, to: TransactionStatus, actor: Actor, options: TransitionOptions = {}) {
    const [current] = await tx.select().from(transactions).where(eq(transactions.id, transactionId)).for('update');
    if (!current) throw Errors.notFound('Transaction');
    const from = current.status as TransactionStatus;
    if (options.expectedVersion !== undefined && options.expectedVersion !== current.version) {
      throw new AppError(HttpStatus.CONFLICT, 'TRANSACTION_CHANGED', 'This order changed in the meantime. Refresh and try again.');
    }
    const actors = allowedActors(from, to, current.heldFromStatus as TransactionStatus | null);
    if (!actors.length) {
      throw new AppError(HttpStatus.CONFLICT, 'INVALID_TRANSITION', `An order cannot move from ${from} to ${to}`);
    }
    if (!actors.includes(actor.type)) {
      throw Errors.forbidden(`This step (${from} to ${to}) cannot be performed by ${actor.type.toLowerCase()}`);
    }

    const enteringHold = HOLD_STATES.includes(to) && !HOLD_STATES.includes(from);
    const leavingHold = HOLD_STATES.includes(from) && !HOLD_STATES.includes(to);
    const [updated] = await tx
      .update(transactions)
      .set({
        ...options.set,
        ...(SUB_STATUS_ON_ENTER[to] ?? {}),
        status: to,
        version: sql`${transactions.version} + 1`,
        heldFromStatus: enteringHold ? from : leavingHold ? null : current.heldFromStatus,
        updatedAt: new Date(),
      })
      .where(eq(transactions.id, transactionId))
      .returning();

    await tx.insert(transactionEvents).values({
      transactionId,
      fromStatus: from,
      toStatus: to,
      actorType: actor.type,
      actorUserId: actor.userId ?? null,
      reason: options.reason ?? null,
      metadata: options.metadata ?? {},
    });
    await this.notifier.onTransition(tx, updated!, from, to);
    return updated!;
  }

  /** Records the first event for a newly inserted transaction (status CREATED). */
  async recordCreated(tx: Tx, transactionId: string, actor: Actor) {
    await tx.insert(transactionEvents).values({ transactionId, fromStatus: null, toStatus: 'CREATED', actorType: actor.type, actorUserId: actor.userId ?? null });
  }
}
