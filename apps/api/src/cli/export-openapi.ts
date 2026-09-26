import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { buildOpenApiDocument, configureApp } from '../bootstrap';
import { loadConfig } from '../config/config';

/** Writes docs/openapi.json. Needs no database connection (the pool connects lazily). */
async function main() {
  const config = loadConfig({
    DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
    WEB_BASE_URL: 'http://localhost:3000',
    MFA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    EMAIL_FROM: 'docs@example.com',
    ...process.env,
  });
  const app = await NestFactory.create(AppModule.forRoot(config), { logger: false });
  configureApp(app, config);
  await app.init();
  const out = path.resolve(__dirname, '../../../../docs/openapi.json');
  writeFileSync(out, JSON.stringify(buildOpenApiDocument(app), null, 2) + '\n');
  await app.close();
  console.log(`Wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
