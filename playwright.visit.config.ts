import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// `npm run test:visit`: a visit on a ticket (src/visit/), on Lantern Reed Gardens, against the sample backend
// (MUSE_BACKEND=fake), whose clock the tests move on. Its own ports, never reused: VISIT_API_PORT and VISIT_APP_PORT
// move them for a checkout whose usual ports are taken.
const API_PORT = Number(process.env.VISIT_API_PORT ?? 8812);
const APP_PORT = Number(process.env.VISIT_APP_PORT ?? 5314);

export default defineConfig({
  ...base,
  testDir: './src/visit',
  testMatch: /visit\.spec\.ts/,
  projects: [{ name: 'visit' }],
  use: { ...base.use, baseURL: `http://localhost:${APP_PORT}` },
  timeout: 180_000,
  webServer: [
    {
      command: `MUSE_BACKEND=fake MUSE_PORT=${API_PORT} npx tsx --no-warnings server/http.ts`,
      url: `http://localhost:${API_PORT}/api/muses`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `MUSE_API=http://localhost:${API_PORT} npx vite --port ${APP_PORT} --strictPort`,
      url: `http://localhost:${APP_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
