import { drizzle } from 'drizzle-orm/node-postgres';
import { getPostgresPool } from '../lib/storage/postgres';
import * as schema from './schema';

let dbInstance: any = null;

export function getDrizzle() {
  if (dbInstance) return dbInstance;
  
  const pool = getPostgresPool();
  if (!pool) {
    throw new Error('PostgreSQL Pool is not initialized. Cannot create Drizzle client.');
  }
  
  dbInstance = drizzle(pool, { schema });
  return dbInstance;
}
