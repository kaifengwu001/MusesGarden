/// <reference types="node" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

// A dedicated server and output directory keep this world's review runs away
// from neighbouring planet checkouts and the meadow's own frame baselines.
const repo = fileURLToPath(new URL('../../', import.meta.url));
const port = Number(process.env.MEADOW_PORT ?? 5231);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MEADOW_PORT must be a valid port');
const baseURL = `http://127.0.0.1:${port}`;
const gl = process.env.MEADOW_GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');
const glArgs: Record<string, string[]> = {
  metal: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  d3d11: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
};

export default defineConfig({
  testDir: './dev',
  outputDir: '../../test-results/violet-dunes',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL,
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    launchOptions: { args: glArgs[gl] ?? [] },
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'violet-dunes:ecology', testMatch: /ecology\.spec\.ts/ },
    { name: 'violet-dunes:invariants', testMatch: /invariants\.spec\.ts/ },
    { name: 'violet-dunes:lock', testMatch: /lock\.spec\.ts/ },
    { name: 'violet-dunes:globe', testMatch: /globe\.spec\.ts/ },
  ],
  webServer: {
    command: `npx vite --host 127.0.0.1 --port ${port} --strictPort`,
    cwd: repo,
    url: `${baseURL}/environments/violet-dunes/`,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
