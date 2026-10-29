import { defineConfig } from 'vitest/config';

// CPU-side invariant tests (pure TypeScript, no GPU). Browser invariants and
// screenshots run under Playwright (playwright.config.ts).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
