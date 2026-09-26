import { Client } from 'pg';
import { runMigrations } from '../src/db/migrate';
import { createDatabase } from '../src/db/db';
import { seedReferenceData } from '../src/db/seed';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://iie:iie@127.0.0.1:5432/iie_test';

/** Rebuilds the test database from migrations. Dropping the schema is the only way to clear append-only tables. */
export default async function setup() {
  if (!/_test\b/.test(new URL(TEST_DATABASE_URL).pathname)) {
    throw new Error('Refusing to reset a database whose name does not end in _test');
  }
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  await client.query('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  await client.end();
  await runMigrations(TEST_DATABASE_URL);
  const { db, pool } = createDatabase(TEST_DATABASE_URL);
  await seedReferenceData(db);
  await pool.end();
}
