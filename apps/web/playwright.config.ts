import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';

/**
 * End-to-end test of the pilot flow against real servers: the API (port 4000, as in the default build) and the
 * built web app (3100).
 * Needs PostgreSQL at E2E_DATABASE_URL and a prior `pnpm build`.
 */
// Must match API_ORIGIN used when the web app was built: Next.js fixes the /api/v1 proxy target at build time.
const API_PORT = Number(process.env.E2E_API_PORT ?? 4000);
const WEB_PORT = 3100;
const root = path.resolve(__dirname, '../..');
export const EMAIL_DIR = process.env.E2E_EMAIL_DIR ?? path.join(__dirname, 'e2e/.emails');
/**
 * Set E2E_BASE_URL to test an already-running site instead (e.g. the staging stack built locally) with sandbox email
 * written to E2E_EMAIL_DIR and the administrator below already created. No servers are started then.
 */
const EXTERNAL_BASE_URL = process.env.E2E_BASE_URL;
export const ADMIN = { email: 'e2e-admin@iie.example', password: 'e2e-admin-password-123' };

const apiEnv = {
  APP_ENV: 'test',
  API_PORT: String(API_PORT),
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? 'postgres://iie:iie@127.0.0.1:5432/iie_e2e',
  WEB_BASE_URL: `http://localhost:${WEB_PORT}`,
  COOKIE_SECURE: 'false',
  TRUST_PROXY: 'true',
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  EMAIL_FROM: 'IIE E2E <e2e@example.com>',
  EMAIL_SANDBOX_DIR: EMAIL_DIR,
  MEDIA_LOCAL_DIR: path.join(__dirname, 'e2e/.media'),
  OUTBOX_IN_PROCESS: 'true',
  OUTBOX_POLL_MS: '200',
  AUTH_RATE_LIMIT_PER_MIN: '1000',
  IIE_ADMIN_EMAIL: ADMIN.email,
  IIE_ADMIN_PASSWORD: ADMIN.password,
};

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: EXTERNAL_BASE_URL ?? `http://localhost:${WEB_PORT}`, ignoreHTTPSErrors: !!EXTERNAL_BASE_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: EXTERNAL_BASE_URL ? [] : [
    {
      // Prepares the database (migrations, reference data, administrator) and starts the API.
      command: 'node dist/db/migrate.js && node dist/db/seed.js && node dist/cli/create-admin.js && node dist/main.js',
      cwd: path.join(root, 'apps/api'),
      env: apiEnv,
      url: `http://127.0.0.1:${API_PORT}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx next start -H 127.0.0.1 -p ${WEB_PORT}`,
      cwd: __dirname,
      env: { API_ORIGIN: `http://127.0.0.1:${API_PORT}`, NEXT_TELEMETRY_DISABLED: '1' },
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
