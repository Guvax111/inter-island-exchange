import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/config';
import { createTestApp, lastEmailTo, register, TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await createTestApp({ ENVIRONMENT_LABEL: 'Pilot rehearsal' });
});
afterAll(() => ctx.close());

describe('pilot rehearsal site', () => {
  it('labels every email as a test order, in the subject and at the top', async () => {
    const { email } = await register(ctx, { verify: false });
    await ctx.flush();
    const mail = lastEmailTo(ctx, email);
    expect(mail.subject).toBe('[Pilot rehearsal] Confirm your email address');
    expect(mail.text.split('\n')[0]).toMatch(/^Pilot rehearsal: .*No real money has moved and no goods will be shipped\.$/);
    expect(mail.html).toMatch(/^<p [^>]*>Pilot rehearsal: this email is about a test order/);
  });

  it('is refused in production', () => {
    const base = {
      APP_ENV: 'production',
      DATABASE_URL: 'postgres://x:y@db:5432/iie',
      WEB_BASE_URL: 'https://example.com',
      MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      EMAIL_FROM: 'IIE <iie@example.com>',
      ENVIRONMENT_LABEL: 'Pilot rehearsal',
    };
    expect(() => loadConfig(base)).toThrow(/ENVIRONMENT_LABEL: Test-site labels are not allowed in production/);
  });
});
