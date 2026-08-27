import { withAuthAndRateLimit } from '@/lib/api/withAuthAndRateLimit';
import { NextResponse } from 'next/server';
import { toConnectorCatalog } from '@/lib/connectors/registry';

/**
 * Source-type catalog for the add-source wizard. Served straight from the
 * connector registry — the same descriptors that validate configs and run
 * extractions — so the wizard fields and the sync worker can never drift.
 */
export const GET = withAuthAndRateLimit(async (req, authCtx, props) => {
  return NextResponse.json({ sourceTypes: toConnectorCatalog() });
});
