import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// npx vite build --config environments/tulip-windmill-meadows/vite.config.ts → dist-environments/tulip-windmill-meadows/
const here = fileURLToPath(new URL('.', import.meta.url));
const repo = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  root: here,
  base: './',
  build: {
    target: 'es2022',
    outDir: `${repo}dist-environments/tulip-windmill-meadows`,
    emptyOutDir: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1024,
  },
  server: { fs: { allow: [repo] }, proxy: { '/api': process.env.MUSE_API ?? 'http://localhost:8787' } },
});
