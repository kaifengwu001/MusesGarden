import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'.',testMatch:/rice-browser\.spec\.ts$/,workers:1,timeout:90000,
  outputDir:'../../../test-results/rice-terraces',
  use:{baseURL:'http://127.0.0.1:5247',viewport:{width:1440,height:900},deviceScaleFactor:1,launchOptions:{args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist']}},
  reporter:'list',
});
