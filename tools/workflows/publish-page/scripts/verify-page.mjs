// After a publish: is the live page the commit you meant, and does it run?
//   node verify-page.mjs <url> [commit]
// 1. The live index.html and the bundle(s) it names. 2. Each bundle parses (node --check: a broken bundle is a
// blank page for everyone; iteration 17's first publish was one). 3. A headless load: the harness ready, no page
// errors. 4. With a commit: a clean production build of it (as publish.sh builds) names the same bundle.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILDS, HERE, launch, openPage } from '../../drive-app/scripts/lib.mjs';

const [url, commit] = process.argv.slice(2);
if (!url) {
  console.error('usage: node verify-page.mjs <url> [commit]');
  process.exit(2);
}
const base = url.replace(/\/+$/, '');
let ok = true;
const html = await (await fetch(`${base}/`, { cache: 'no-store' })).text();
const bundles = [...html.matchAll(/src="\.?(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
console.log(`${base}: ${bundles.length ? bundles.join(', ') : 'NO BUNDLE in index.html'}`);
if (!bundles.length) ok = false;
const dir = mkdtempSync(join(tmpdir(), 'verify-page-'));
for (const b of bundles) {
  const res = await fetch(`${base}${b}`, { cache: 'no-store' });
  const body = await res.text();
  const file = join(dir, b.split('/').pop().replace(/\.js$/, '.mjs'));
  writeFileSync(file, body);
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  const parses = check.status === 0;
  if (!parses) ok = false;
  console.log(`  ${b}: HTTP ${res.status}, ${(body.length / 1024).toFixed(0)} KB, ${parses ? 'parses' : `DOES NOT PARSE\n${check.stderr.split('\n').slice(0, 6).join('\n')}`}`);
}
const browser = await launch();
try {
  const X = await openPage(browser, base, { hash: 'hud=0', width: 1280, height: 800, dpr: 1 });
  const s = await X.page.evaluate(() => window.__meadow.stats());
  console.log(`  headless load: ready, tier ${s.tier}, first frame ${Math.round(s.firstFrameMs)} ms${X.errors.length ? `, PAGE ERRORS: ${X.errors.slice(0, 4).join(' | ')}` : ', no page errors'}`);
  if (X.errors.length) ok = false;
} catch (e) {
  ok = false;
  console.log(`  headless load FAILED: ${String(e.message ?? e).split('\n')[0]}`);
}
await browser.close();
if (commit) {
  const name = `verify-${commit.replace(/[^a-z0-9]/gi, '').slice(0, 12)}`;
  const built = spawnSync(join(HERE, 'build-at.sh'), [name, commit], { encoding: 'utf8', env: { ...process.env, PLAIN: '1' } });
  if (built.status !== 0) {
    ok = false;
    console.log(`  clean build of ${commit} FAILED: ${built.stderr.slice(0, 400)}`);
  } else {
    const local = [...readFileSync(join(BUILDS, name, 'index.html'), 'utf8').matchAll(/src="\.?(\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
    const same = local.length > 0 && local.length === bundles.length && local.every((b, i) => b === bundles[i]);
    if (!same) ok = false;
    console.log(`  clean build of ${commit}: ${local.join(', ')} ${same ? '= the live page' : '≠ THE LIVE PAGE'}`);
  }
}
console.log(ok ? 'OK' : 'NOT OK');
process.exit(ok ? 0 : 1);
