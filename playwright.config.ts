import { readdirSync, existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// MEADOW_PORT: a checkout of its own, so a server from another checkout on 5199 is never reused by mistake.
const environments = existsSync('environments') ? readdirSync('environments').filter(name => existsSync(`environments/${name}/dev`)) : [];
const PORT = Number(process.env.MEADOW_PORT ?? 5199);

// Headless Chromium on macOS can render through the real GPU (ANGLE on Metal),
// which gives honest perf numbers and timer queries. MEADOW_GL=swiftshader
// switches to the CPU rasterizer for frame hashes that match across machines.
const GL_ARGS: Record<string, string[]> = {
  metal: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  swiftshader: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};
const gl = process.env.MEADOW_GL ?? (process.platform === 'darwin' ? 'metal' : 'swiftshader');

export default defineConfig({
  testDir: './src/dev',
  testMatch: /.*\.spec\.ts/,
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    launchOptions: { args: GL_ARGS[gl] ?? [] },
  },
  projects: [
    { name: 'shots', testMatch: /shots\.spec\.ts/ },
    { name: 'invariants', testMatch: /invariants\.spec\.ts/ },
    { name: 'squint', testMatch: /squint\.spec\.ts/ },
    { name: 'ukiyoe-pine-hamlet:flicker', testDir: './environments/ukiyoe-pine-hamlet/dev', testMatch: /flicker\.spec\.ts$/ },
    ...environments.flatMap(name => ['invariants', 'lock', 'residents', 'ecology'].map(suite => ({ name: `${name}:${suite}`, testDir: `./environments/${name}/dev`, testMatch: new RegExp(`${suite}\\.spec\\.ts$`) }))),
  ],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
