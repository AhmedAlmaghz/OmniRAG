import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  typescript: {
    // Type safety is owned by `npm run typecheck` (local pre-commit + CI), not
    // by the production image build: inside a memory-constrained Docker VM the
    // tsc pass ran 13+ minutes and OOM-killed the buildkit engine (observed
    // v0.12.21). Docker builds set NEXT_SKIP_TYPECHECK=1; every other path
    // keeps the strict gate on.
    ignoreBuildErrors: process.env.NEXT_SKIP_TYPECHECK === '1',
  },
  // tesseract.js spawns worker threads and streams its WASM core from
  // node_modules at runtime — bundling it into the server build breaks both.
  // pg-boss/pg/imapflow/mysql2 are Node-only modules loaded lazily by the job
  // queue and connectors; keep them external to the server bundle too.
  serverExternalPackages: ['tesseract.js', 'pg-boss', 'pg', 'imapflow', 'mysql2'],
  experimental: {
    webpackBuildWorker: false,
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  allowedDevOrigins: [
    '*.run.app',
    '*.europe-west1.run.app',
    '*.europe-west3.run.app',
    'localhost:3000',
    '0.0.0.0:3000',
  ],
  env: {
    NEXT_PUBLIC_APP_URL: process.env.APP_URL || '',
  },
};
export default nextConfig;
