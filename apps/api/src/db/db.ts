import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;
/** A database handle or an open transaction; services accept either so callers control atomicity. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0] | Database;

export const DB = Symbol('DB');
export const PG_POOL = Symbol('PG_POOL');

export function createDatabase(databaseUrl: string): { db: Database; pool: Pool } {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}
