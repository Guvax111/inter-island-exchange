import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import type { AppConfig } from './config/config';
import { requestIdMiddleware } from './common/request';

export const API_PREFIX = 'api/v1';

/** Shared by the server entry point and the integration tests so both run the same HTTP pipeline. */
export function configureApp(app: INestApplication, config: AppConfig): void {
  const http = app.getHttpAdapter().getInstance();
  http.disable('x-powered-by');
  if (config.TRUST_PROXY) http.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  app.use(requestIdMiddleware);
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
}

export function buildOpenApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Inter-Island Exchange API')
    .setDescription(
      'Version 1. Authentication uses the httpOnly `iie_session` cookie. State-changing requests made with a session must send the ' +
        '`X-CSRF-Token` header (value from the `iie_csrf` cookie or `GET /me`). Errors are `{ error: { code, message, details?, requestId } }`.',
    )
    .setVersion('1.0')
    .addCookieAuth('iie_session')
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}
