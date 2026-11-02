import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// npx vite build --config environments/violet-dunes/vite.config.ts → dist-environments/violet-dunes/
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  build: {
    target: 'es2022',
    outDir: `${repo}dist-environments/violet-dunes`,
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1024,
  },
  server: { fs: { allow: [repo] } },
});
