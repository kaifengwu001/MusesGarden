import { defineConfig } from 'vitest/config';

// CPU-side tests (pure TypeScript, no GPU): world invariants and the Muse server. Browser invariants and
// screenshots run under Playwright (playwright.config.ts).
export default defineConfig({
  // a sculpt (a GLB) can be read as a data URL, as museMesh.test.ts reads Muse's
  assetsInclude: ['**/*.glb'],
  test: {
    include: ['src/**/*.test.ts', 'server/**/*.test.ts', 'environments/**/*.test.ts'],
    // Planets the workshop forks for real Muses are per-laptop and git-ignored (server/workshop/planet).
    exclude: ['**/node_modules/**', 'environments/muse-*/**'],
    environment: 'node',
  },
});
