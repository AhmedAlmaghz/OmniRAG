import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // The default 5s per-test timeout is too tight for this suite: several
    // tests perform real Argon2 hashing, AES-GCM round-trips, or drive 11
    // sequential rate-limited requests, and on slower machines/CI the module
    // transform + import phase alone eats seconds before the test body runs.
    // 30s keeps fast tests fast (they still finish in ms) while removing
    // flakes where a legitimately slow test crosses a 5s wall under load.
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
