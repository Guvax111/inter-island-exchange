import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/config';
import { OutboxService } from './outbox.service';

@Injectable()
export class OutboxPoller implements OnApplicationShutdown {
  private readonly logger = new Logger('OutboxPoller');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly outbox: OutboxService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  start(): void {
    this.logger.log(`Polling outbox every ${this.config.OUTBOX_POLL_MS}ms`);
    const tick = async () => {
      if (this.running) return;
      this.running = true;
      try {
        while ((await this.outbox.processBatch()) > 0) {
          // keep draining while there is work
        }
      } catch (err) {
        this.logger.error(err);
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(() => void tick(), this.config.OUTBOX_POLL_MS);
    void tick();
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
