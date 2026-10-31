import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode single` inlines every script, style and shader into one
// self-contained index.html (dist-single/). The Google Font stays a link.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: single ? [viteSingleFile()] : [],
    build: {
      target: 'es2022',
      outDir: single ? 'dist-single' : 'dist',
      sourcemap: !single,
      assetsInlineLimit: single ? Number.MAX_SAFE_INTEGER : 4096,
      // three.js alone is ~550 kB minified; one chunk is the point of this app.
      chunkSizeWarningLimit: 1024,
    },
    // The Muse server (npm run serve) answers /api during development.
    server: { port: 5173, proxy: { '/api': 'http://localhost:8787' } },
  };
});
