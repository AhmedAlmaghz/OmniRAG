import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || process.env.POSTGRES_URL || '',
  },
  // The pgvector adapter (src/lib/storage/vectors/adapters/pgvector.ts)
  // provisions its own tables at runtime — one per embedding dimension
  // (`vector_chunks`, `vector_chunks_d<dim>`) — and the pgboss schema is
  // created by pg-boss on boot. Both live outside src/db/schema.ts on
  // purpose, so push/generate must never see (and try to drop) them.
  tablesFilter: ['!vector_chunks', '!vector_chunks_*', '!pgboss.*', '!pgboss_*'],
});
