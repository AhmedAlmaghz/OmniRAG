import nextPlugin from '@next/eslint-plugin-next';
import tseslint from 'typescript-eslint';

/**
 * Flat-config ESLint setup for OmniRAG (Next.js 16 App Router + TypeScript).
 *
 * Strategy: enforce the rules that matter most for a multi-tenant app
 * (no-leak secrets, no debug code in shipped paths, React hook correctness)
 * while keeping the existing codebase lintable. `@typescript-eslint/no-explicit-any`
 * is surfaced as a warning, not an error, so the team can drive it to zero
 * incrementally without blocking CI.
 */
export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'dist/**',
      'coverage/**',
      'playwright-report/**',
      'src/db/**/*.ts', // generated Drizzle layer has no public types
      'public/**',
      'server.ts',
      'dev-server.js',
      'seed_patch.cjs',
      'test-*.{ts,js}',
      'agent-evolution-deck/**', // standalone deck generator (CommonJS script, not app code)
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,jsx,mjs,cjs}'],
    plugins: { '@next/next': nextPlugin },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@next/next/no-img-element': 'off',
    },
  },
  {
    // Security-critical, already-any-free layers: no-explicit-any is an ERROR
    // here so a new `any` cannot silently land in the auth/API-gateway/security
    // code. The rest of the codebase is on a documented warn-then-zero plan
    // (568 → ~418 since v0.12.14).
    files: ['src/lib/api/**/*.{ts,tsx}', 'src/lib/security/**/*.{ts,tsx}', 'src/lib/auth/**/*.{ts,tsx}', 'proxy.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['src/app/api/**/*.{ts,tsx}'],
    rules: {
      // API routes must not leak internal error text to clients.
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'Literal[raw=/err\\.message/]',
          message: 'Do not surface err.message to API clients; return a generic message and log internally.',
        },
      ],
    },
  },
);
