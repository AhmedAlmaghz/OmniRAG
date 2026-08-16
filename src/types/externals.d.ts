/**
 * Ambient module declarations that compensate for missing `.d.ts` companions in
 * third-party packages installed here (drizzle-orm 0.45.x ships only `.d.cts`,
 * and `firebase/firestore`'s subpath types are unresolved for older bundler
 * resolution). Kept intentionally narrow to the surface this repo imports.
 *
 * When these packages ship proper `.d.ts`, remove the corresponding entries.
 */

// ---------------------------------------------------------------------------
// drizzle-orm/pg-core — column builders + table builder used by src/db/schema.
// ---------------------------------------------------------------------------
declare module 'drizzle-orm/pg-core' {
  export interface ColumnConfig<T = any> {
    name: string;
    notNull?: boolean;
    default?: T | (() => T);
    defaultRandom?: boolean;
    primaryKey?: boolean;
    unique?: boolean;
    references?: () => any;
    onUpdate?: () => any;
  }
  export type PgColumnBuilder<TName extends string = string, TData = any> = {
    name: TName;
    notNull(): PgColumnBuilder<TName, TData>;
    primaryKey(): PgColumnBuilder<TName, TData>;
    default(value: TData | (() => TData)): PgColumnBuilder<TName, TData>;
    defaultRandom(): PgColumnBuilder<TName, TData>;
    unique(): PgColumnBuilder<TName, TData>;
    references(fn: () => any): PgColumnsBuilder<TName, TData>;
    array(): PgColumnsBuilder<TName, TData>;
  };
  export type PgColumnsBuilder<TName extends string = string, TData = any> = {
    name: TName;
    notNull?: boolean;
    primaryKey?: boolean;
    unique?: boolean;
    references?: () => any;
    array?: boolean;
  };
  export function pgTable(name: string, columns: Record<string, any>, extra?: Record<string, any>): any;
  export function varchar(name: string, opts?: { length?: number | string }): PgColumnBuilder;
  export function text(name: string): PgColumnBuilder;
  export function integer(name: string): PgColumnBuilder;
  export function jsonb(name: string): PgColumnBuilder;
  export function boolean(name: string): PgColumnBuilder;
  export function timestamp(name: string, opts?: { mode?: 'date' | 'string'; withTimezone?: boolean }): PgColumnBuilder;
  export function serial(name: string): PgColumnBuilder;

  // Re-typing helpers commonly re-exported from pg-core but unused here.
  export type SQL = any;
}

// ---------------------------------------------------------------------------
// drizzle-orm/node-postgres — drizzle() factory used by src/db.
// ---------------------------------------------------------------------------
declare module 'drizzle-orm/node-postgres' {
  export function drizzle(client: any, schema?: Record<string, any>): any;
}

// ---------------------------------------------------------------------------
// firebase/firestore — subset surfaced to src/lib/firebase.ts in the browser
// build path. The full types are provided by the `firebase` package root.
// ---------------------------------------------------------------------------
declare module 'firebase/firestore' {
  export type Firestore = any;
  export type DocumentData = Record<string, any>;
  export type LogLevel = 'debug' | 'error' | 'silent';
  export const getFirestore: (app: any, databaseId?: string) => any;
  export const initializeFirestore: (app: any, settings?: any, databaseId?: string) => any;
  export const setLogLevel: (logLevel: LogLevel) => void;
  export const collection: (db: any, path: string, ...segments: string[]) => any;
  export const doc: (db: any, path: string, ...segments: string[]) => any;
  export const getDoc: (ref: any) => Promise<any>;
  export const getDocs: (ref: any) => Promise<any>;
  export const setDoc: (ref: any, data: any) => Promise<void>;
  export const addDoc: (ref: any, data: any) => Promise<any>;
  export const updateDoc: (ref: any, data: any) => Promise<void>;
  export const deleteDoc: (ref: any) => Promise<void>;
  export const query: (ref: any, ...constraints: any[]) => any;
  export const where: (field: string, op: string, value: any) => any;
  export const orderBy: (field: string, direction?: 'asc' | 'desc') => any;
  export const limit: (n: number) => any;
}
