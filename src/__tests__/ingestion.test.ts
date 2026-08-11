import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { SYSTEM_CONFIG } from '../lib/config/systemConfig';
import { checkRateLimit } from '../lib/security/rateLimiter';

describe('System Config & Rate Limiter Tests', () => {
  it('should load default RAG system configurations', () => {
    expect(SYSTEM_CONFIG.DEFAULT_TENANT_ID).toBe('tenant-acme-01');
    expect(SYSTEM_CONFIG.RAG.RRF_CONSTANT_K).toBe(60);
    expect(SYSTEM_CONFIG.RAG.HYBRID_WEIGHTS.SEMANTIC).toBe(0.7);
    expect(SYSTEM_CONFIG.RAG.HYBRID_WEIGHTS.LEXICAL).toBe(0.3);
  });

  it('should rate limit requests exceeding threshold', () => {
    const req = new NextRequest('http://localhost:3000/api/v1/chat/completions', {
      headers: { 'x-forwarded-for': '127.0.0.1' },
    });
    
    // First request should pass
    const firstCheck = checkRateLimit(req, 2, 60000);
    expect(firstCheck.success).toBe(true);

    // Second request should pass
    const secondCheck = checkRateLimit(req, 2, 60000);
    expect(secondCheck.success).toBe(true);

    // Third request should be blocked
    const thirdCheck = checkRateLimit(req, 2, 60000);
    expect(thirdCheck.success).toBe(false);
    expect(thirdCheck.response?.status).toBe(429);
  });
});

