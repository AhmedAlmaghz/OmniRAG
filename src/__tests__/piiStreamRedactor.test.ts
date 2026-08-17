import { describe, it, expect } from 'vitest';
import { createPIIStreamRedactor } from '../lib/security/piiStreamRedactor';

/**
 * Regression guard for Phase 5 / Fix 3: streamed PII redaction.
 *
 * chat/completions runs the H9 PIIRedactor hook over the full response as one
 * string. chat/stream emits text deltas and would otherwise bypass H9 entirely.
 * These tests assert the streaming redactor intercepts emails and phone numbers
 * even when the PII pattern is split across multiple push() deltas, and that
 * it never releases the un-redacted tail of a partial pattern.
 */
describe('Phase 5/Fix 3 — PII streaming redactor', () => {
  function run(deltas: string[]): string {
    const r = createPIIStreamRedactor();
    let out = '';
    for (const d of deltas) out += r.push(d);
    out += r.end();
    return out;
  }

  it('redacts a whole email delivered in a single delta', () => {
    const out = run(['You can reach support at user@example.com anytime.']);
    expect(out).toBe('You can reach support at [REDACTED:EMAIL] anytime.');

    const r = createPIIStreamRedactor();
    r.push('user@example.com ');
    expect(r.didRedact()).toBe(true);
  });

  it('redacts an email split across many deltas without leaking the tail', () => {
    const out = run(['Contact ', 'user@', 'example', '.com', ' please']);
    expect(out).toBe('Contact [REDACTED:EMAIL] please');
  });

  it('redacts a phone number split across deltas', () => {
    const out = run(['Call ', '(555) 123', '-', '4567', '!']);
    expect(out).toBe('Call [REDACTED:PHONE]!');
  });

  it('redacts a complete email that arrives without a trailing terminator', () => {
    // The stream ends immediately after `.com` with no terminator character.
    // push() cannot yet know the pattern is complete (no non-email char follows
    // to satisfy the streaming lookahead), so it holds it back; end() must
    // still redact it from the trailing buffer.
    const r = createPIIStreamRedactor();
    let out = r.push('partial email user@example.com');
    expect(out).toBe('');
    out += r.end();
    expect(out).toContain('[REDACTED:EMAIL]');
    expect(out).not.toContain('user@example.com');
  });

  it('passes through non-PII text unchanged', () => {
    const out = run(['Hello world, ', 'this is a clean response ', 'with no secrets.']);
    expect(out).toBe('Hello world, this is a clean response with no secrets.');

    const r = createPIIStreamRedactor();
    const pushed = r.push('clean text');
    expect(pushed).toBe('');
    expect(r.end()).toBe('clean text');
  });
});
