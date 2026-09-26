import 'reflect-metadata';
import { eq } from 'drizzle-orm';
import { emailSchema, passwordSchema } from '@iie/shared';
import { createDatabase } from '../db/db';
import { auditLogs, countries, roles, userRoles, users } from '../db/schema';
import { hashPassword } from '../auth/passwords';

/**
 * Creates the first super administrator (or grants super_admin to an existing user).
 * Usage: DATABASE_URL=... IIE_ADMIN_EMAIL=... IIE_ADMIN_PASSWORD=... IIE_ADMIN_COUNTRY=LC pnpm --filter @iie/api admin:create
 * The password is read from the environment so it never appears in shell history or process lists.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const email = emailSchema.parse(process.env.IIE_ADMIN_EMAIL);
  const password = passwordSchema.parse(process.env.IIE_ADMIN_PASSWORD);
  const countryCode = (process.env.IIE_ADMIN_COUNTRY ?? 'LC').toUpperCase();
  const { db, pool } = createDatabase(url);
  try {
    await db.transaction(async (tx) => {
      const [country] = await tx.select().from(countries).where(eq(countries.isoAlpha2, countryCode));
      if (!country) throw new Error(`Country ${countryCode} not found. Run the seed first.`);
      const [role] = await tx.select().from(roles).where(eq(roles.key, 'super_admin'));
      if (!role) throw new Error('Roles not seeded. Run the seed first.');
      let [user] = await tx.select().from(users).where(eq(users.email, email));
      if (!user) {
        [user] = await tx
          .insert(users)
          .values({
            email,
            passwordHash: await hashPassword(password),
            firstName: 'IIE',
            lastName: 'Administrator',
            countryId: country.id,
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            onboardingSubmittedAt: new Date(),
          })
          .returning();
      }
      await tx.insert(userRoles).values({ userId: user!.id, roleId: role.id }).onConflictDoNothing();
      await tx.insert(auditLogs).values({
        action: 'user.role_granted',
        entityType: 'user',
        entityId: user!.id,
        after: { role: 'super_admin', via: 'cli' },
      });
      console.log(`Super administrator ready: ${email}`);
    });
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
