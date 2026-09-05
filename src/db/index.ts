import { drizzle } from 'drizzle-orm/node-postgres';
import { getOwnerPool } from '../lib/storage/postgres';
import * as schema from './schema';

let dbInstance: any = null;

export function resetDrizzle() {
  dbInstance = null;
}

/**
 * Drizzle client over the OWNER pool — schema management and seeding only.
 * Drizzle has no runtime query consumers; all tenant-scoped access goes
 * through postgres.ts functions on the runtime pool (see getPostgresPool),
 * where Row Level Security applies. Routing runtime reads through the owner
 * would silently bypass RLS.
 */
export function getDrizzle() {
  if (dbInstance) return dbInstance;

  const pool = getOwnerPool();
  if (!pool) {
    throw new Error('PostgreSQL Pool is not initialized. Cannot create Drizzle client.');
  }

  dbInstance = drizzle(pool, { schema });
  return dbInstance;
}
