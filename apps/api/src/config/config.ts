import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .transform((v) => v === 'true');

const envSchema = z
  .object({
    APP_ENV: z.enum(['local', 'test', 'staging', 'production']).default('local'),
    API_PORT: z.coerce.number().int().default(4000),
    DATABASE_URL: z.string().min(1),
    /** Public URL of the web app; used to build links in emails. */
    WEB_BASE_URL: z.url(),
    /** Comma-separated origins allowed to make state-changing requests. Defaults to WEB_BASE_URL. */
    ALLOWED_ORIGINS: z.string().optional(),
    TRUST_PROXY: bool.default(false),
    COOKIE_SECURE: bool.default(true),
    SESSION_ABSOLUTE_HOURS: z.coerce.number().int().min(1).default(24 * 14),
    SESSION_IDLE_HOURS: z.coerce.number().int().min(1).default(72),
    /** 32 random bytes, base64. Encrypts MFA secrets at rest. */
    MFA_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'Must be 32 bytes, base64-encoded'),
    EMAIL_PROVIDER: z.enum(['sandbox', 'smtp']).default('sandbox'),
    EMAIL_FROM: z.string().min(3),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_SECURE: bool.default(true),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    OUTBOX_POLL_MS: z.coerce.number().int().min(100).default(2000),
    /** Run the outbox poller inside the API process (convenient locally). Use the separate worker in staging/production. */
    OUTBOX_IN_PROCESS: bool.default(false),
    RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(300),
    /** Per-IP limit for sign-in, sign-up and password endpoints. */
    AUTH_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(10),
    /** File storage for images. `local` writes to MEDIA_LOCAL_DIR (local/test/single-instance staging only). */
    STORAGE_PROVIDER: z.enum(['local']).default('local'),
    MEDIA_LOCAL_DIR: z.string().default('.media'),
    MAX_UPLOAD_MB: z.coerce.number().min(1).max(20).default(8),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === 'smtp') {
      for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: `${key} is required when EMAIL_PROVIDER=smtp` });
      }
    }
    if (env.APP_ENV === 'production') {
      if (env.EMAIL_PROVIDER === 'sandbox') {
        ctx.addIssue({ code: 'custom', path: ['EMAIL_PROVIDER'], message: 'Sandbox providers are not allowed in production' });
      }
      if (env.STORAGE_PROVIDER === 'local') {
        ctx.addIssue({ code: 'custom', path: ['STORAGE_PROVIDER'], message: 'Local disk storage is not allowed in production; configure object storage' });
      }
      if (!env.COOKIE_SECURE) ctx.addIssue({ code: 'custom', path: ['COOKIE_SECURE'], message: 'Must be true in production' });
      if (!env.WEB_BASE_URL.startsWith('https://')) {
        ctx.addIssue({ code: 'custom', path: ['WEB_BASE_URL'], message: 'Must be https in production' });
      }
    }
  });

export type AppConfig = z.infer<typeof envSchema> & { allowedOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${details}`);
  }
  const allowedOrigins = (parsed.data.ALLOWED_ORIGINS ?? new URL(parsed.data.WEB_BASE_URL).origin)
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return { ...parsed.data, allowedOrigins };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
