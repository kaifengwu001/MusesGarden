import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * `virtual:terraces-build-hash`: a hash of the terraces' build's own code (its worker and every module it imports, as
 * they are on disk), the key a finished build is kept under in the browser (src/terraces/build/worker.ts), so a page
 * loads it again unless the code that makes the geometry changed. Worked out again whenever one of those files does.
 */
function terracesBuildHash(): Plugin {
  const id = 'virtual:terraces-build-hash';
  const resolved = `\0${id}`;
  const entry = resolve(root, 'src/terraces/build/worker.ts');
  const isFile = (path: string): boolean => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  };
  let files = new Set<string>();
  const graph = (): Set<string> => {
    const seen = new Set<string>();
    const visit = (file: string): void => {
      if (seen.has(file)) return;
      seen.add(file);
      for (const m of readFileSync(file, 'utf8').matchAll(/(?:import|export)[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) {
        const base = resolve(dirname(file), (m[1] ?? m[2]).split('?')[0]);
        const hit = [base, `${base}.ts`, `${base}/index.ts`].find(isFile);
        if (hit) visit(hit);
      }
    };
    visit(entry);
    return seen;
  };
  return {
    name: 'terraces-build-hash',
    resolveId: (source) => (source === id ? resolved : null),
    load(loaded) {
      if (loaded !== resolved) return null;
      files = graph();
      const h = createHash('sha1');
      for (const f of [...files].sort()) {
        h.update(relative(root, f));
        h.update(readFileSync(f));
        this.addWatchFile(f);
      }
      return `export default ${JSON.stringify(h.digest('hex').slice(0, 16))};`;
    },
    handleHotUpdate({ file, server }) {
      if (!files.has(file)) return;
      const mod = server.moduleGraph.getModuleById(resolved);
      if (mod) server.moduleGraph.invalidateModule(mod);
    },
  };
}

// `vite build --mode single` inlines every script, style and shader into one
// self-contained index.html (dist-single/). The Google Font stays a link.
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: './',
    plugins: single ? [viteSingleFile(), terracesBuildHash()] : [terracesBuildHash()],
    worker: { plugins: () => [terracesBuildHash()] },
    build: {
      target: 'es2022',
      outDir: single ? 'dist-single' : 'dist',
      sourcemap: !single,
      assetsInlineLimit: single ? Number.MAX_SAFE_INTEGER : 4096,
      // three.js alone is ~550 kB minified; one chunk is the point of this app.
      chunkSizeWarningLimit: 1024,
    },
    server: { port: 5173 },
  };
});
