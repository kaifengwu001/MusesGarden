import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// `npx playwright test -c playwright.live.config.ts`: the overlay against the real engine on a fresh garden.
// The Muse server starts on :8787 (Vite proxies /api there) with a throwaway data folder and the fast-forward clock.
const DATA = '.muse-live-e2e';

export default defineConfig({
  ...base,
  testDir: './src/muse/ui',
  testMatch: /live\.e2e\.ts/,
  projects: [{ name: 'muse-live' }],
  use: { ...base.use, actionTimeout: 30_000 },
  expect: { timeout: 30_000 },
  timeout: 600_000,
  webServer: [
    {
      command: `rm -rf ${DATA} && MUSE_DATA=${DATA} MUSE_PORT=8787 npx tsx --no-warnings server/http.ts`,
      url: 'http://localhost:8787/api/muses',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'npx vite --port 5199 --strictPort',
      url: 'http://localhost:5199',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
