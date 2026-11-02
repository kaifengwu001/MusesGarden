import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// `npx playwright test -c playwright.live.config.ts`: the dev tools and the 3D Muse, then the garden's interface, against the
// real engine on a fresh garden. The garden's tests move the clock days ahead, so they run after the dev tools' test.
// The Muse server starts on :8787 (Vite proxies /api there) with a throwaway data folder and the fast-forward clock.
// MUSE_PORT and LIVE_APP_PORT move both, for a checkout whose usual ports are taken.
const DATA = '.muse-live-e2e';
const MUSE_PORT = Number(process.env.MUSE_PORT ?? 8787);
const APP_PORT = Number(process.env.LIVE_APP_PORT ?? 5298);

export default defineConfig({
  ...base,
  testDir: './src/muse/ui',
  testMatch: /(live|garden)\.e2e\.ts/,
  projects: [
    { name: 'muse-live', testMatch: /live\.e2e\.ts/ },
    { name: 'garden-live', testMatch: /garden\.e2e\.ts/, dependencies: ['muse-live'] },
  ],
  // Its own app port, never reused: another checkout's dev server on a shared port would be tested instead.
  use: { ...base.use, baseURL: `http://localhost:${APP_PORT}`, actionTimeout: 30_000 },
  expect: { timeout: 30_000 },
  timeout: 600_000,
  webServer: [
    {
      command: `rm -rf ${DATA} && MUSE_DATA=${DATA} MUSE_PORT=${MUSE_PORT} npx tsx --no-warnings server/http.ts`,
      url: `http://localhost:${MUSE_PORT}/api/muses`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `MUSE_API=http://localhost:${MUSE_PORT} npx vite --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
