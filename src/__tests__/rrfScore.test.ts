import { describe, it, expect } from 'vitest';
import { computeRrfScore } from '@/lib/rag/engine';

describe('computeRrfScore — Reciprocal Rank Fusion', () => {
  it('scores only the semantic branch when only a semantic rank is provided', () => {
    const s = computeRrfScore(1, null, 0.7, 0.3, 60);
    // 1/(60+1) * 0.7
    expect(s).toBeCloseTo((1 / 61) * 0.7, 10);
  });

  it('scores only the lexical branch when only a lexical rank is provided', () => {
    const s = computeRrfScore(null, 2, 0.7, 0.3, 60);
    expect(s).toBeCloseTo((1 / 62) * 0.3, 10);
  });

  it('fuses both branches in the documented ratio', () => {
    const s = computeRrfScore(1, 2, 0.7, 0.3, 60);
    expect(s).toBeCloseTo((1 / 61) * 0.7 + (1 / 62) * 0.3, 10);
  });

  it('is deterministic: identical inputs yield identical outputs', () => {
    const a = computeRrfScore(3, 5);
    const b = computeRrfScore(3, 5);
    expect(a).toBe(b);
  });

  it('returns zero when both ranks are null or non-positive', () => {
    expect(computeRrfScore(null, null)).toBe(0);
    expect(computeRrfScore(0, 0)).toBe(0);
  });

  it('rewards higher (earlier) ranks with larger scores', () => {
    const rank1 = computeRrfScore(1, 1);
    const rank5 = computeRrfScore(5, 5);
    expect(rank1).toBeGreaterThan(rank5);
  });
});
