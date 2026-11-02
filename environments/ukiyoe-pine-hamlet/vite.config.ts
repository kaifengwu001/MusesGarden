import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// npx vite build --config environments/ukiyoe-pine-hamlet/vite.config.ts → dist-environments/ukiyoe-pine-hamlet/
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  cacheDir: '../../.vite-ukiyoe-build-cache',
  build: {
    target: 'es2022',
    outDir: `${repo}dist-environments/ukiyoe-pine-hamlet`,
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1024,
  },
  server: { fs: { allow: [repo] }, proxy: { '/api': process.env.MUSE_API ?? 'http://localhost:8787' } },
});
