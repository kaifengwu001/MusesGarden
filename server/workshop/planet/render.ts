// Stills of a Muse's planet, taken in headless Chromium by the drive-app skill's look.mjs on the page's dev server,
// then made into the round's pictures (JPEG), a contact sheet beside Muse's moodboard picks, and its postcard stills.
// The renderer is a port, so tests stub it.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

/**
 * One shot, as look.mjs takes it: a preset or a pose, with the tilt, field of view and turn pinned; `js` runs in the
 * page after that and before the picture is taken (here: aiming the camera at the planet's own places).
 */
export interface Shot {
  readonly name: string;
  readonly hash?: string;
  readonly preset?: 'homestead' | 'lakes' | 'meadow' | 'vista' | 'muse';
  readonly pose?: string;
  readonly tilt?: number;
  readonly fov?: number;
  readonly turn?: number;
  readonly js?: string;
}

/**
 * Page code (window.__world, on the dev server) that aims the camera at this planet's own places, found on its land:
 * its home, the highest ground within 90 m of it (a hill or knoll a Muse asked for) and the lowest (where its water
 * gathers). The fixed poses framed the same spot of every planet, which on Blu's showed neither its pond nor its
 * knoll, so a Muse took them for missing. Without a world the shot keeps its pose.
 */
function aim(at: 'orbit' | 'overview' | 'high' | 'water'): string {
  return `(() => {
  const w = window.__world;
  if (!w || !w.rig || !w.terrain || !w.terrain.layout) return 'kept its pose: no world on the page';
  const L = w.terrain.layout, R = (w.growth && w.growth.radius) || 128, rig = w.rig;
  const home = L.cottage.clone().normalize();
  const tangent = (p, q) => q.clone().addScaledVector(p, -q.dot(p)).normalize();
  const travel = (p, t, a) => p.clone().multiplyScalar(Math.cos(a)).addScaledVector(t, Math.sin(a)).normalize();
  const north = tangent(home, L.homeBearing);
  const east = north.clone().cross(home).normalize();
  let hi = home, hiH = -Infinity, lo = home, loH = Infinity;
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * Math.PI * 2;
    const t = north.clone().multiplyScalar(Math.cos(a)).addScaledVector(east, Math.sin(a));
    for (let d = 15; d <= 90; d += 5) {
      const p = travel(home, t, d / R);
      const h = w.terrain.height(p);
      if (h > hiH) { hiH = h; hi = p; }
      if (h < loH) { loH = h; lo = p; }
    }
  }
  const at = ${JSON.stringify(at)};
  if (at === 'orbit') { rig.lookAlong(home, tangent(home, hi), true); rig.setZoom(0, true); }
  if (at === 'overview') { const back = travel(home, tangent(home, hi), -30 / R); rig.lookAlong(back, tangent(back, hi), true); rig.setZoom(rig.zoomForAltitude(45), true); }
  if (at === 'high') { rig.lookAlong(hi, tangent(hi, home), true); rig.setZoom(rig.zoomForAltitude(4), true); }
  if (at === 'water') {
    // (on the shore away from the home, looking back across the water at it)
    const away = tangent(lo, home).negate();
    let shore = lo;
    for (let d = 2; d <= 40; d += 2) { shore = travel(lo, away, d / R); if (w.terrain.height(shore) > loH + 1.5) break; }
    rig.lookAlong(shore, tangent(shore, home), true); rig.setZoom(rig.zoomForAltitude(1.6), true);
  }
  if (w.markPosed) w.markPosed();
  return 'aimed: high ground ' + (hiH - w.terrain.height(home)).toFixed(1) + ' m over the home, water ' + (loH - w.terrain.height(home)).toFixed(1) + ' m';
})()`;
}

export interface View extends Shot {
  /** What it shows, for Muse. */
  readonly caption: string;
  /** The postcard stills it stands for (src/assets/postcards/stills.ts StillKey), in order. */
  readonly cards: readonly string[];
}

/**
 * The six views of a draft, every one on this planet's own places: the orbit, the bird's-eye view, the high ground
 * and the water's edge are aimed by `aim` (the poses are the meadow's standard views, kept for a page without a world);
 * the vista and the home are presets, which find them on the planet's own layout.
 */
export const VIEWS: readonly View[] = [
  { name: 'orbit', caption: 'The whole planet from orbit, your home in the middle', pose: '-0.426,0.3515,0.2406,0.7982,0', tilt: 0, fov: 35, js: aim('orbit'), cards: ['beyond'] },
  { name: 'birds-eye', caption: 'From the air behind your home, looking over it toward the high ground', pose: '-0.426,0.3515,0.2406,0.7982,0.35', tilt: 55, fov: 45, js: aim('overview'), cards: ['scenery'] },
  { name: 'standing', caption: 'On the highest ground near your home, looking back at it', pose: '-0.426,0.3515,0.2406,0.7982,0.8301', tilt: 80, fov: 52, js: aim('high'), cards: ['scenery'] },
  { name: 'vista', caption: 'The vista across the land', preset: 'vista', cards: ['scenery', 'invitation'] },
  { name: 'home', caption: 'Your home', preset: 'homestead', cards: ['home'] },
  { name: 'eye-level', caption: 'At eye level across the water, looking back at your home', pose: '-0.2406,0.7982,-0.426,-0.3515,1', tilt: 82, fov: 55, js: aim('water'), cards: ['closeup'] },
];

export interface StillsRequest {
  /** The planet's page, e.g. http://localhost:5402/environments/muse-test (no hash). */
  readonly url: string;
  readonly shots: readonly Shot[];
  /** Added to every shot's hash (the seed, a time of day). */
  readonly hash?: string;
  /** PNGs go here, one per shot. */
  readonly outDir: string;
  readonly signal?: AbortSignal;
  readonly log?: (line: string) => void;
}

export interface Renderer {
  /** One PNG per shot, in order (absolute paths). Throws, in plain words, when a shot can't be taken. */
  stills(req: StillsRequest): Promise<string[]>;
}

/** Still size: 3:2 like the postcards, drawn at 1440 × 960. */
const W = 1440;
const H = 960;
const LOOK_TIMEOUT_MS = 6 * 60_000;

const fileFor = (name: string): string => `${name.replace(/[^a-z0-9.-]+/gi, '_')}.png`;

/** The real renderer: look.mjs in a child process (this Node, the repo's Playwright), on a dev server's page. */
export function lookRenderer(repo: string): Renderer {
  const script = join(repo, 'tools/workflows/drive-app/scripts/look.mjs');
  return {
    async stills({ url, shots, hash, outDir, signal, log }) {
      await reachable(url, signal);
      mkdirSync(outDir, { recursive: true });
      const spec = shots.map((s) => ({ ...s, hash: [hash, s.hash].filter(Boolean).join('&') }));
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(
          process.execPath,
          [script, url, JSON.stringify(spec), outDir],
          { cwd: repo, env: { ...process.env, W: String(W), H: String(H), DPR: '1', Q: 'high', T: '12' }, timeout: LOOK_TIMEOUT_MS, maxBuffer: 8 << 20, signal },
          (err, out, errOut) => (err ? reject(new Error(`the renderer stopped: ${(errOut || err.message).trim().split('\n').slice(-3).join(' ')}`)) : resolve(out)),
        );
      });
      for (const line of stdout.split('\n').filter(Boolean)) log?.(`look: ${line}`);
      return shots.map((s) => {
        const file = join(outDir, fileFor(s.name));
        if (!existsSync(file)) {
          const said = stdout.split('\n').find((l) => l.startsWith(`${s.name}:`)) ?? 'no still was written';
          throw new Error(`the ${s.name} still couldn’t be taken (${said.slice(0, 200)})`);
        }
        return file;
      });
    },
  };
}

async function reachable(url: string, signal?: AbortSignal): Promise<void> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/`, { signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]) });
    if (!res.ok) throw new Error(`it answered ${res.status}`);
  } catch (e) {
    throw new Error(`the planet’s page ${url}/ can’t be opened (${e instanceof Error ? e.message : String(e)}); is the dev server (npm run dev) running?`, { cause: e });
  }
}

/** A picture as a JPEG, fitted inside width × height (never enlarged). */
export async function toJpeg(input: string | Buffer, out: string, width = W, height = H, quality = 84): Promise<void> {
  await sharp(input).resize(width, height, { fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality }).toFile(out);
}

/** A smaller copy of a picture for a model to look at. */
export async function forModel(file: string, width = 768): Promise<Buffer> {
  return sharp(file).resize(width, undefined, { withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c);

/** A labelled contact sheet of pictures, three to a row, as a JPEG. */
export async function contactSheet(tiles: readonly { readonly label: string; readonly file: string }[], out: string, title = ''): Promise<void> {
  const cols = 3;
  const tw = 480;
  const th = 320;
  const label = 26;
  const gap = 8;
  const top = title ? 34 : 0;
  const rows = Math.ceil(tiles.length / cols);
  const width = cols * tw + (cols + 1) * gap;
  const height = top + rows * (th + label) + (rows + 1) * gap;
  const parts = await Promise.all(
    tiles.map(async (t, i) => {
      const x = gap + (i % cols) * (tw + gap);
      const y = top + gap + Math.floor(i / cols) * (th + label + gap);
      const img = await sharp(t.file).resize(tw, th, { fit: 'cover' }).toBuffer();
      const text = Buffer.from(`<svg width="${tw}" height="${label}"><text x="4" y="18" font-family="Helvetica, Arial, sans-serif" font-size="15" fill="#333">${esc(t.label)}</text></svg>`);
      return [
        { input: text, left: x, top: y },
        { input: img, left: x, top: y + label },
      ];
    }),
  );
  if (title) parts.push([{ input: Buffer.from(`<svg width="${width}" height="${top}"><text x="${gap}" y="24" font-family="Helvetica, Arial, sans-serif" font-size="18" font-weight="bold" fill="#222">${esc(title)}</text></svg>`), left: 0, top: 0 }]);
  await sharp({ create: { width, height, channels: 3, background: '#faf8f0' } })
    .composite(parts.flat())
    .jpeg({ quality: 84 })
    .toFile(out);
}

/**
 * A planet's postcard stills from a draft's: src/assets/postcards/<planet>/<key>-<n>.jpg at 960 × 640, n counting from
 * 1 per key in the views' order (server/fixtures/planetStills.ts reads them). The folder's old stills go first.
 */
export async function writePostcards(repo: string, planet: string, stills: readonly { readonly view: View; readonly file: string }[]): Promise<string[]> {
  const dir = join(repo, 'src/assets/postcards', planet);
  if (existsSync(dir)) for (const f of readdirSync(dir)) if (/^[a-z-]+-\d+\.(?:jpe?g|png)$/.test(f)) rmSync(join(dir, f));
  mkdirSync(dir, { recursive: true });
  const counts = new Map<string, number>();
  const written: string[] = [];
  for (const { view, file } of stills) {
    for (const key of view.cards) {
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      const out = join(dir, `${key}-${n}.jpg`);
      await sharp(file).resize(960, 640, { fit: 'cover' }).jpeg({ quality: 82 }).toFile(out);
      written.push(out);
    }
  }
  return written;
}

/** Times of day a view can be asked at (params light.timeOfDay: 5.5 to 19). */
const TIMES_OF_DAY: readonly { readonly words: RegExp; readonly hours: number }[] = [
  { words: /\b(dawn|sunrise|daybreak|early morning)\b/, hours: 6.3 },
  { words: /\b(morning)\b/, hours: 9 },
  { words: /\b(noon|midday)\b/, hours: 12.5 },
  { words: /\b(afternoon)\b/, hours: 15.5 },
  { words: /\b(dusk|sunset|evening|golden hour|twilight|night|stars?)\b/, hours: 18.6 },
];

const VIEW_WORDS: readonly { readonly words: RegExp; readonly view: string }[] = [
  { words: /\b(porch|home|house|hut|cottage|door|garden gate|doorstep)\b/, view: 'home' },
  { words: /\b(orbit|space|whole planet|globe|from afar|all of it)\b/, view: 'orbit' },
  { words: /\b(bird|birds-eye|bird's-eye|overhead|from above|aerial|map)\b/, view: 'birds-eye' },
  { words: /\b(knoll|hill|hilltop|high ground|highest|summit|peak|mound|rocks?|stargazing|top|rise|standing|stand)\b/, view: 'standing' },
  { words: /\b(pond|pools?|lake|shore|water|water's edge|eye level)\b/, view: 'eye-level' },
  { words: /\b(vista|horizon|across|far|distance|view out|panorama|lookout)\b/, view: 'vista' },
  { words: /\b(ground|grass|flowers?|plants?|walk|close|closer)\b/, view: 'eye-level' },
];

/** A view and a time of day from Muse's words, by keywords; null when no view is named. */
export function viewFromWords(ask: string): { readonly view: View; readonly hours: number | null } | null {
  const words = ask.toLowerCase().replace(/[’‘]/g, "'");
  const named = VIEW_WORDS.find((v) => v.words.test(words));
  const time = TIMES_OF_DAY.find((t) => t.words.test(words));
  const view = VIEWS.find((v) => v.name === (named?.view ?? (time ? 'vista' : '')));
  return view ? { view, hours: time?.hours ?? null } : null;
}
