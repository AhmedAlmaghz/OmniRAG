/**
 * i18n — centralized ar/en dictionaries (Phase 7).
 *
 * Replaces scattered `lang === 'ar' ? '…' : '…'` ternaries with keyed
 * lookups. Migration is deliberately gradual (component by component):
 * unmigrated components keep their inline ternaries, migrated ones call
 * `t(lang, 'namespace.key')`.
 *
 * Design:
 * - `en.ts` is the shape of record; `ar.ts` is typed against it, so a missing
 *   or extra key in either dictionary is a compile error — the two languages
 *   cannot drift.
 * - Flat dotted keys grouped by namespace (`header.signOut`, `plans.usage`).
 * - `{placeholder}` interpolation with optional params.
 * - Pure functions, no React dependency: usable in routes and services too.
 */

import { en } from './dictionaries/en';
import { ar } from './dictionaries/ar';

export type Locale = 'ar' | 'en';

/** Dictionary shape of record (English). Arabic must satisfy the same keys. */
export type Dictionary = typeof en;

const dictionaries: Record<Locale, Dictionary> = { en, ar };

export const SUPPORTED_LOCALES: readonly Locale[] = ['ar', 'en'] as const;

export function isLocale(value: unknown): value is Locale {
  return value === 'ar' || value === 'en';
}

export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale] ?? en;
}

/**
 * Translate a dotted key for a locale, with `{name}` interpolation.
 * Falls back to the English value, then to the key itself, so a missing
 * string degrades visibly in development instead of rendering empty.
 */
export function t(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const value = lookup(getDictionary(locale), key) ?? lookup(en, key) ?? key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (match, name: string) =>
    params[name] !== undefined ? String(params[name]) : match,
  );
}

function lookup(dict: Dictionary, key: string): string | undefined {
  const parts = key.split('.');
  let node: unknown = dict;
  for (const part of parts) {
    if (node === null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}
