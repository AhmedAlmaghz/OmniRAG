/**
 * userPreferences.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Global, persistent user-preference store for OmniRAG.
 *
 * Design goals (best practices):
 *  • Single source of truth — one JSON blob in localStorage, one in-memory
 *    state object, one subscription mechanism. No scattered keys.
 *  • Zero-dependency external store consumed through `useSyncExternalStore`,
 *    so every subscribed component re-renders automatically when a setting
 *    changes — even across memoized parents (e.g. chat messages).
 *  • Hydration-safe: the in-memory state starts at DEFAULT_PREFERENCES on
 *    both server and first client render; localStorage is read only inside
 *    a post-mount effect, so SSR markup and hydration always match.
 *  • Automatic DOM application: theme class, font family, font size and
 *    density are written to <html> as data-attributes + classes, so pure-CSS
 *    rules in globals.css apply them app-wide without prop drilling.
 *  • Legacy-key migration from the old scattered `omnirag_theme`,
 *    `omnirag-theme`, `omnirag_font_size`, `omnirag_density` and
 *    `omnirag_arabic_font` entries.
 */

import { useEffect, useSyncExternalStore } from 'react';

/* ── Types ─────────────────────────────────────────────────────────────── */

export type ThemeMode = 'light' | 'dark' | 'system';
export type FontSize = 'sm' | 'md' | 'lg';
export type Density = 'comfortable' | 'compact';
export type ArabicFont = 'cairo' | 'tajawal' | 'ibm';
/** Math rendering engine: standard KaTeX (LTR) or KaTeX4Arabic (RTL Arabic). */
export type MathMode = 'standard' | 'arabic';
/** UI language (Phase 7 i18n). Personal preference — stays client-side. */
export type UiLanguage = 'ar' | 'en';

export interface UserPreferences {
  theme: ThemeMode;
  fontSize: FontSize;
  density: Density;
  arabicFont: ArabicFont;
  /** How LaTeX math is rendered in chat responses (applied automatically). */
  mathMode: MathMode;
  /** When mathMode === 'arabic': render digits as Arabic-Indic (٠-٩). */
  mathArabicNumerals: boolean;
  /** UI language for the i18n dictionaries (ar/en). */
  language: UiLanguage;
}

export const STORAGE_KEY = 'omnirag_user_preferences_v1';

export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: 'light',
  fontSize: 'md',
  density: 'comfortable',
  arabicFont: 'cairo',
  // OmniRAG is an Arabic-first platform: KaTeX4Arabic is the default engine.
  mathMode: 'arabic',
  mathArabicNumerals: false,
  // Arabic-first default UI language.
  language: 'ar',
};

/* ── Validation helpers (never trust storage blindly) ─────────────────── */

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

function sanitize(raw: Partial<UserPreferences> | null | undefined): UserPreferences {
  const r = raw ?? {};
  return {
    theme: pick(r.theme, ['light', 'dark', 'system'] as const, DEFAULT_PREFERENCES.theme),
    fontSize: pick(r.fontSize, ['sm', 'md', 'lg'] as const, DEFAULT_PREFERENCES.fontSize),
    density: pick(r.density, ['comfortable', 'compact'] as const, DEFAULT_PREFERENCES.density),
    arabicFont: pick(r.arabicFont, ['cairo', 'tajawal', 'ibm'] as const, DEFAULT_PREFERENCES.arabicFont),
    mathMode: pick(r.mathMode, ['standard', 'arabic'] as const, DEFAULT_PREFERENCES.mathMode),
    mathArabicNumerals:
      typeof r.mathArabicNumerals === 'boolean' ? r.mathArabicNumerals : DEFAULT_PREFERENCES.mathArabicNumerals,
    language: pick(r.language, ['ar', 'en'] as const, DEFAULT_PREFERENCES.language),
  };
}

/** One-time migration from the legacy scattered localStorage keys. */
function migrateLegacy(): Partial<UserPreferences> {
  if (typeof window === 'undefined') return {};
  const legacy: Partial<UserPreferences> = {};
  try {
    const theme = localStorage.getItem('omnirag_theme') || localStorage.getItem('omnirag-theme');
    if (theme) legacy.theme = theme as ThemeMode;
    const fontSize = localStorage.getItem('omnirag_font_size');
    if (fontSize) legacy.fontSize = fontSize as FontSize;
    const density = localStorage.getItem('omnirag_density');
    if (density) legacy.density = density as Density;
    const arabicFont = localStorage.getItem('omnirag_arabic_font');
    if (arabicFont) legacy.arabicFont = arabicFont as ArabicFont;
  } catch {
    /* storage unavailable — defaults apply */
  }
  return legacy;
}

function loadFromStorage(): UserPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    /* corrupted JSON — fall through to migration/defaults */
  }
  return sanitize(migrateLegacy());
}

/* ── Store core ────────────────────────────────────────────────────────── */

let state: UserPreferences = DEFAULT_PREFERENCES;
let hydrated = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a failing listener must never break the store */
    }
  });
}

function persist(prefs: UserPreferences) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / privacy mode — in-memory state still works */
  }
  // Mirror language + theme into cookies so the server renders <html lang/dir>
  // and the dark class on FIRST byte (no flash, correct screen-reader
  // language). max-age = 1 year, Lax — same-site navigations always carry it.
  try {
    const cookie = (name: string, value: string) => {
      document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
    };
    cookie('omnirag_lang', prefs.language);
    cookie('omnirag_theme', resolveTheme(prefs.theme));
  } catch {
    /* cookie writes can be blocked — localStorage above is the real store */
  }
}

/* ── DOM application ───────────────────────────────────────────────────── */

export function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Writes the preferences onto <html>. globals.css keys off these attributes,
 * so the whole application (including memoized chat messages) restyles
 * instantly with no React re-render required for pure-CSS concerns.
 */
export function applyPreferencesToDom(prefs: UserPreferences) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const resolved = resolveTheme(prefs.theme);
  root.classList.toggle('dark', resolved === 'dark');
  root.dataset.theme = resolved;
  root.dataset.fontSize = prefs.fontSize;
  root.dataset.density = prefs.density;
  root.dataset.arabicFont = prefs.arabicFont;
}

/* ── Public imperative API ─────────────────────────────────────────────── */

export function getPreferences(): UserPreferences {
  return state;
}

export function updatePreferences(patch: Partial<UserPreferences>) {
  state = sanitize({ ...state, ...patch });
  persist(state);
  applyPreferencesToDom(state);
  notify();
}

export function subscribePreferences(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Hydration-safe bootstrap: reads localStorage once after mount and pushes
 * the saved values into the store. Safe to call repeatedly.
 */
export function hydratePreferencesFromStorage() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  const loaded = loadFromStorage();
  const changed = (Object.keys(loaded) as Array<keyof UserPreferences>).some((k) => loaded[k] !== state[k]);
  if (changed) {
    state = loaded;
    applyPreferencesToDom(state);
    notify();
  } else {
    applyPreferencesToDom(state);
  }
}

/* ── System theme tracking ─────────────────────────────────────────────── */

let mediaListenerInstalled = false;

function ensureSystemThemeListener() {
  if (mediaListenerInstalled || typeof window === 'undefined') return;
  mediaListenerInstalled = true;
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (state.theme !== 'system') return;
    // Same preferences object, but the *resolved* theme changed — re-apply
    // the DOM class and notify so resolved-theme subscribers re-render.
    applyPreferencesToDom(state);
    notify();
  };
  if (typeof mediaQuery.addEventListener === 'function') mediaQuery.addEventListener('change', onChange);
  else mediaQuery.addListener(onChange); // Safari < 14 fallback
}

/* ── React bindings ────────────────────────────────────────────────────── */

/**
 * Subscribe a component to the full preferences object.
 *
 * Also guarantees the preferences are hydrated from storage and applied to
 * the DOM once on mount, so whichever client component mounts first
 * bootstraps the document styling.
 */
export function useUserPreferences(): {
  preferences: UserPreferences;
  update: (patch: Partial<UserPreferences>) => void;
  resolvedTheme: 'light' | 'dark';
} {
  const preferences = useSyncExternalStore(subscribePreferences, getPreferences, () => DEFAULT_PREFERENCES);

  useEffect(() => {
    hydratePreferencesFromStorage();
    ensureSystemThemeListener();
  }, []);

  const resolvedTheme = useSyncExternalStore(
    subscribePreferences,
    () => resolveTheme(state.theme),
    () => 'light' as const,
  );

  return { preferences, update: updatePreferences, resolvedTheme };
}

/** Lightweight hook when a component only cares about the resolved theme. */
export function useResolvedTheme(): 'light' | 'dark' {
  useEffect(() => {
    hydratePreferencesFromStorage();
    ensureSystemThemeListener();
  }, []);
  return useSyncExternalStore(
    subscribePreferences,
    () => resolveTheme(state.theme),
    () => 'light' as const,
  );
}
