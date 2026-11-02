import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// npx vite build --config environments/cobalt-windfields/vite.config.ts → dist-environments/cobalt-windfields/
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  cacheDir: `${repo}.vite-cache/cobalt-windfields`,
  build: {
    target: 'es2022',
    outDir: `${repo}dist-environments/cobalt-windfields`,
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1024,
  },
  server: { fs: { allow: [repo] }, proxy: { '/api': process.env.MUSE_API ?? 'http://localhost:8787' } },
});
