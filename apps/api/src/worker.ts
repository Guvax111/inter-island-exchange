import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config/config';
import { OutboxPoller } from './outbox/outbox.poller';

/** Background worker: delivers outbox events (emails today; webhooks and scheduled jobs in later phases). */
async function main() {
  const config = loadConfig();
  const app = await NestFactory.createApplicationContext(AppModule.forRoot(config));
  app.enableShutdownHooks();
  app.get(OutboxPoller).start();
  new Logger('Worker').log(`IIE worker (${config.APP_ENV}) started`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
