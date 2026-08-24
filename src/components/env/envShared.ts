'use client';

import { fetchWithAuth } from '@/lib/auth/fetchWithAuth';
import { copyToClipboard } from '@/lib/clipboard';

/**
 * Shared logic for the two environment-configuration surfaces
 * (EnvVariablesManager and FirstLaunchEnvModal).
 *
 * These ~120 lines were previously DUPLICATED almost verbatim in both
 * components — types, status loading, per-key testing, save-to-server and
 * .env template copying — and had already drifted (different Arabic error
 * strings, one checked nothing on save). Both surfaces now delegate here so a
 * change to the API contract happens in exactly one place.
 */

export interface EnvVarItem {
  key: string;
  category: 'ai' | 'database' | 'vector' | 'docai' | 'ingress';
  categoryTitleAr: string;
  categoryTitleEn: string;
  nameAr: string;
  nameEn: string;
  descAr: string;
  descEn: string;
  required: boolean;
  isConfigured: boolean;
  isInjectedBySystem: boolean;
  maskedPreview: string;
  docsUrl: string;
}

export interface EnvTestResult {
  success: boolean;
  message: string;
  latencyMs?: number;
}

/** Values containing this mask marker are server previews, never user input. */
const MASK_MARKER = '•';
export const ENV_LOCAL_PREFIX = 'omnirag_env_';

export function isMasked(value: string | undefined): boolean {
  return !!value && value.includes(MASK_MARKER);
}

export interface EnvStatusPayload {
  envList: EnvVarItem[];
  readinessScore: number;
  /** Initial editable values seeded from localStorage (masked previews → ''). */
  formValues: Record<string, string>;
}

/** GET /api/v1/env-config + local draft seeding. Returns null on failure. */
export async function loadEnvStatus(): Promise<EnvStatusPayload | null> {
  try {
    const res = await fetchWithAuth('/api/v1/env-config');
    if (!res.ok) return null;
    const data = await res.json();
    const envList: EnvVarItem[] = data.envList || [];

    const formValues: Record<string, string> = {};
    for (const item of envList) {
      let savedLocal = '';
      try {
        savedLocal = localStorage.getItem(`${ENV_LOCAL_PREFIX}${item.key}`) || '';
      } catch {
        /* storage unavailable */
      }
      formValues[item.key] = savedLocal && !isMasked(savedLocal) ? savedLocal : '';
    }

    return { envList, readinessScore: data.readinessPercentage ?? 100, formValues };
  } catch (err) {
    console.error('Failed to load env status:', err);
    return null;
  }
}

/** Mirrors an edited value into the local draft store (masked edits skipped). */
export function persistFormValue(key: string, value: string): void {
  if (isMasked(value)) return;
  try {
    localStorage.setItem(`${ENV_LOCAL_PREFIX}${key}`, value);
  } catch {
    /* storage unavailable */
  }
}

/** POST action:'test' for a single key. Never throws — returns a result object. */
export async function testEnvKey(key: string, rawValue: string | undefined): Promise<EnvTestResult> {
  try {
    const cleanVal = rawValue && !isMasked(rawValue) ? rawValue.trim() : '';
    const res = await fetchWithAuth('/api/v1/env-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'test', key, value: cleanVal }),
    });
    const data = await res.json().catch(() => ({ success: false, message: `HTTP ${res.status}` }));
    return { success: !!data.success, message: data.message || '', latencyMs: data.latencyMs };
  } catch (err: any) {
    return { success: false, message: `خطأ أثناء الاتصال: ${err?.message || err}` };
  }
}

/**
 * POST action:'save' for all non-empty drafts. Returns whether the SERVER
 * accepted the write — production deployments may block persistence, which
 * both UIs now surface honestly instead of congratulating regardless.
 */
export async function saveEnvsToServer(formValues: Record<string, string>): Promise<boolean> {
  const envsToSave: Record<string, string> = {};
  for (const [k, v] of Object.entries(formValues)) {
    if (v && !isMasked(v) && v.trim() !== '') {
      envsToSave[k] = v.trim();
      try {
        localStorage.setItem(`${ENV_LOCAL_PREFIX}${k}`, v.trim());
      } catch {
        /* storage unavailable */
      }
    }
  }

  try {
    const res = await fetchWithAuth('/api/v1/env-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', envs: envsToSave }),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => ({ success: true }));
    return data?.success !== false;
  } catch {
    return false;
  }
}

/** Builds a ready-to-paste .env body from the current list + drafts. */
export function buildDotEnvTemplate(envList: EnvVarItem[], formValues: Record<string, string>): string {
  const lines = envList.map((item) => {
    const val = formValues[item.key] || '';
    return `${item.key}="${val.replace(/"/g, '\\"')}"`;
  });
  return `# OmniRAG Production Environment Configuration\n${lines.join('\n')}`;
}

/** Safe clipboard write for the .env template; returns success honestly. */
export async function copyDotEnvTemplate(envList: EnvVarItem[], formValues: Record<string, string>): Promise<boolean> {
  return copyToClipboard(buildDotEnvTemplate(envList, formValues));
}
