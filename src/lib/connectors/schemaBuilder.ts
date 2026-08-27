import { z } from 'zod';
import type { ConnectorFieldDescriptor } from './types';

/**
 * Builds the runtime zod schema from the SAME field descriptors the wizard
 * renders — one source of truth for form shape and server-side validation.
 *
 * Policy: unknown extra keys are stripped (not rejected) so legacy rows with
 * stale fields keep validating; required fields must be present and non-empty;
 * numbers are coerced from the string values the HTML form produces.
 */
export function buildConfigSchema(fields: ConnectorFieldDescriptor[]): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let fieldSchema: z.ZodTypeAny;
    switch (field.type) {
      case 'number':
        fieldSchema = z.coerce
          .number({ message: `${field.key} must be a number` })
          .refine((n) => Number.isFinite(n), `${field.key} must be a finite number`);
        break;
      case 'checkbox':
        fieldSchema = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);
        break;
      case 'textarea':
      case 'password':
      case 'select':
      case 'text':
      default:
        fieldSchema = z.string();
        if (field.type === 'select' && field.options && field.options.length > 0) {
          const allowed = field.options.map((o) => o.value);
          fieldSchema = z.string().refine((v) => v === '' || allowed.includes(v), {
            message: `${field.key} must be one of: ${allowed.join(', ')}`,
          });
        }
        break;
    }

    if (field.required) {
      const requiredMsg = `${field.key} is required`;
      fieldSchema =
        field.type === 'number' || field.type === 'checkbox'
          ? fieldSchema
          : fieldSchema.refine((v) => typeof v !== 'string' || v.trim() !== '', requiredMsg);
    } else {
      fieldSchema = fieldSchema.optional();
    }

    shape[field.key] = fieldSchema;
  }

  // Strip unknown keys, tolerate missing optional ones.
  return z.object(shape).passthrough() as z.ZodType<Record<string, unknown>>;
}

/** Applies declared field defaults to empty/missing values. */
export function applyFieldDefaults(
  fields: ConnectorFieldDescriptor[],
  config: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config };
  for (const field of fields) {
    const current = out[field.key];
    const isEmpty = current === undefined || current === null || (typeof current === 'string' && current.trim() === '');
    if (isEmpty && field.default !== undefined) out[field.key] = field.default;
  }
  return out;
}
