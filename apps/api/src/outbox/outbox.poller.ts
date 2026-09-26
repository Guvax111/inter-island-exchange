import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { OrdersService } from '../transactions/orders.service';
import { PaymentsService } from '../payments/payments.service';
import { OutboxService } from './outbox.service';

/**
 * Background jobs run by the worker (or in-process locally): deliver outbox events and cancel orders whose
 * payment window has expired, and refund paid orders the seller did not confirm in time. Each job is safe to run
 * in several processes at once.
 */
@Injectable()
export class OutboxPoller implements OnApplicationShutdown {
  private readonly logger = new Logger('BackgroundJobs');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly outbox: OutboxService,
    private readonly orders: OrdersService,
    private readonly payments: PaymentsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** One pass of every job. */
  async tick(): Promise<void> {
    await this.orders.expireOverdue();
    await this.payments.refundUnconfirmed();
    while ((await this.outbox.processBatch()) > 0) {
      // keep draining while there is work
    }
  }

  start(): void {
    this.logger.log(`Running background jobs every ${this.config.OUTBOX_POLL_MS}ms`);
    const run = async () => {
      if (this.running) return;
      this.running = true;
      try {
        await this.tick();
      } catch (err) {
        this.logger.error(err);
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(() => void run(), this.config.OUTBOX_POLL_MS);
    void run();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
