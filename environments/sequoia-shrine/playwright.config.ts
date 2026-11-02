/// <reference types="node" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import base from '../../playwright.config';

const nativeGpu=process.env.SEQUOIA_NATIVE_GPU==='1';

export default defineConfig({
  ...base,
  outputDir:fileURLToPath(new URL('../../test-results/sequoia',import.meta.url)),
  fullyParallel:false,
  workers:1,
  timeout:120_000,
  use:{
    ...base.use,
    baseURL:process.env.SEQUOIA_BASE_URL??'http://localhost:5245',
    viewport:{width:1440,height:1000},
    launchOptions:nativeGpu?{
      ...base.use?.launchOptions,
      args:['--use-angle=d3d11','--enable-gpu','--ignore-gpu-blocklist'],
    }:base.use?.launchOptions,
  },
  projects:[{
    name:'sequoia-forest',
    testDir:fileURLToPath(new URL('./dev',import.meta.url)),
    testMatch:/forest\.spec\.ts$/,
  }],
  webServer:undefined,
});
