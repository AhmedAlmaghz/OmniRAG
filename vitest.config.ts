import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Fork-per-file was tried (v0.12.16) to stop cross-file process.env leaks,
    // but its per-file process spawn + module transforms tripled runtime on
    // slow filesystems and pushed heavy import graphs past testTimeout. The
    // leaks were fixed at the SOURCE instead (afterEach env cleanup in the
    // files that set DATABASE_URL — see lexicalTenantIsolation /
    // tenantPredicateCoverage), so threads stay for speed.
    // The default 5s per-test timeout is too tight for this suite: several
    // tests perform real Argon2 hashing, AES-GCM round-trips, or drive 11
    // sequential rate-limited requests, and on slower machines/CI the module
    // transform + import phase alone eats seconds before the test body runs.
    // 30s keeps fast tests fast (they still finish in ms) while removing
    // flakes where a legitimately slow test crosses a 5s wall under load.
    testTimeout: 60000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
