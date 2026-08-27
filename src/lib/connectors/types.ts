import type { z } from 'zod';
import type { SourceType } from '../types/omnirag';

/**
 * Connector framework — the data-source side of the "adapters + registries"
 * pattern (mirrors the AI provider registry and the storage registries).
 *
 * Every knowledge source (file upload, web page, RSS, YouTube, GitHub,
 * Notion, Google Drive, Confluence, Slack, email, SQL database, generic REST
 * API) is a {@link ConnectorDescriptor}: one file that carries BOTH the UI
 * metadata (names, field shapes, schedule) AND the runtime behavior (config
 * validation, connection test, extraction). The settings wizard renders from
 * the descriptor catalog and the sync worker executes `extract()` — so the
 * historical drift between the UI catalog and the extraction code (different
 * field keys for the same connector) is structurally impossible now.
 *
 * Adding a connector = one adapter file + one registry entry. No UI edits,
 * no sync-worker edits.
 *
 * Honesty contract (unchanged from the liveConnectors era): extraction either
 * returns REAL content or throws with a human-readable reason. Connectors
 * never index fabricated placeholder text.
 */

/** A single config field, rendered by the wizard and validated by the schema. */
export interface ConnectorFieldDescriptor {
  /** Stable config key (what extract() reads). */
  key: string;
  labelAr: string;
  labelEn: string;
  type: 'text' | 'password' | 'number' | 'select' | 'textarea' | 'checkbox';
  required?: boolean;
  /** Default presented in the form (and applied when the field is left empty). */
  default?: string | number | boolean;
  placeholder?: string;
  options?: Array<{ label: string; value: string }>;
  /** Secret fields are masked in the UI and encrypted at rest. */
  secret?: boolean;
  helpAr?: string;
  helpEn?: string;
}

/** Result of a successful extraction — same shape the sync worker consumes. */
export interface ConnectorExtraction {
  /** Document title derived from the source payload. */
  title: string;
  /** Full extracted plain-text/markdown content ready for chunking. */
  content: string;
  /** Canonical public URL the content came from (stored in metadata). */
  sourceUrl?: string;
  /** Number of logical records merged into the content. */
  itemsProcessed: number;
}

export interface ConnectorTestResult {
  ok: boolean;
  messageAr: string;
  messageEn: string;
}

export interface ConnectorDescriptor {
  /** Matches SourceType — the stable id stored on SourceConnector rows. */
  type: SourceType;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  descriptionEn: string;
  /** Wizard grouping. */
  category: 'files' | 'web' | 'workplace' | 'cloud' | 'databases';
  /** lucide icon name rendered by the wizard. */
  iconName: string;
  /** Suggested cron for scheduled syncs ('manual' = on-demand only). */
  defaultSchedule: string;
  /** Whether the connector supports scheduled/background sync at all. */
  supportsSchedule: boolean;
  /** Form fields — the wizard renders these verbatim. */
  fields: ConnectorFieldDescriptor[];
  /**
   * zod schema validating a runtime config object. Built from the same field
   * list the UI renders, so form and validation can never drift.
   */
  configSchema: z.ZodType<Record<string, unknown>>;
  /** Optional connectivity probe used by the wizard's "test" button. */
  testConnection?: (config: Record<string, unknown>) => Promise<ConnectorTestResult>;
  /**
   * Extracts real content for sync. Throws with a readable reason on failure.
   * Connectors whose pipeline lives elsewhere (file upload studio, youtube
   * dedicated path) set this to undefined and the sync worker keeps their
   * specialized flow.
   */
  extract?: (config: Record<string, unknown>) => Promise<ConnectorExtraction>;
}
