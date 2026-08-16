/**
 * Local ambient declarations for the two drizzle-orm subpaths this project
 * imports (`drizzle-orm/node-postgres`, `drizzle-orm/pg-core`).
 *
 * Why: drizzle-orm@0.45.2's package.json `exports` map routes the `types`
 * condition to `<subpath>/index.d.ts`, but those `.d.ts` files are missing
 * from the published artifact (only the `.d.cts` counterparts ship). tsc then
 * falls back to the untyped `index.js` runtime file and raises TS7016. This
 * shim makes the specifiers resolve locally so the build type-checks, and —
 * unlike patching node_modules — survives `npm install`.
 *
 * Scope: only the symbols actually consumed by `src/db/index.ts` and
 * `src/db/schema.ts`. The result of `drizzle(...)` flows into a `dbInstance: any`
 * and the `pgTable` results are consumed only via `import * as schema`, so loose
 * return types here match the existing typing posture of the `src/db` module.
 */
declare module 'drizzle-orm/pg-core' {
  interface PgColumnBuilder {
    primaryKey(): this;
    notNull(): this;
    unique(): this;
    default(value: unknown): this;
  }
  export function varchar(name: string, opts?: { length?: number }): PgColumnBuilder;
  export function text(name: string): PgColumnBuilder;
  export function integer(name: string): PgColumnBuilder;
  export function jsonb(name: string): PgColumnBuilder;
  export function boolean(name: string): PgColumnBuilder;
  export function pgTable(name: string, columns: Record<string, unknown>): Record<string, unknown>;
}

declare module 'drizzle-orm/node-postgres' {
  export function drizzle(client: unknown, config?: { schema?: unknown }): unknown;
}
