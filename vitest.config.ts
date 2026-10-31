import { defineConfig } from 'vitest/config';

// CPU-side invariant tests (pure TypeScript, no GPU). Browser invariants and
// screenshots run under Playwright (playwright.config.ts).
export default defineConfig({
  // a sculpt (a GLB) can be read as a data URL, as museMesh.test.ts reads Muse's
  assetsInclude: ['**/*.glb'],
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
