import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { API_PREFIX, buildOpenApiDocument, configureApp } from './bootstrap';
import { loadConfig } from './config/config';
import { OutboxPoller } from './outbox/outbox.poller';

async function main() {
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.forRoot(config));
  configureApp(app, config);
  if (config.APP_ENV !== 'production') {
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, buildOpenApiDocument(app));
  }
  if (config.OUTBOX_IN_PROCESS) app.get(OutboxPoller).start();
  await app.listen(config.API_PORT, '0.0.0.0');
  new Logger('Bootstrap').log(`IIE API (${config.APP_ENV}) listening on :${config.API_PORT}/${API_PREFIX}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
