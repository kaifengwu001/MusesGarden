import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// npx vite build --config environments/golden-rye/vite.config.ts → dist-environments/golden-rye/
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  build: {
    target: 'es2022',
    outDir: `${repo}dist-environments/golden-rye`,
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1024,
  },
  server: { fs: { allow: [repo] }, proxy: { '/api': process.env.MUSE_API ?? 'http://localhost:8787' } },
});
