import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/security/rateLimiter';
import { buildOpenApiDocument } from '@/lib/api/openapi';

export const dynamic = 'force-dynamic';

/**
 * OpenAPI 3.1 document for the /api/v1 surface (Phase 6). Public and
 * rate-limited — the spec contains no secrets, only the contract.
 */
export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, 30, 60000);
  if (!rl.success && rl.response) return rl.response;

  return NextResponse.json(buildOpenApiDocument(), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
