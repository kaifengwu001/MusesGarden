import { defineConfig } from 'vitest/config';

// CPU-side tests (pure TypeScript, no GPU): world invariants and the Muse server. Browser invariants and
// screenshots run under Playwright (playwright.config.ts).
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts'],
    environment: 'node',
  },
});
