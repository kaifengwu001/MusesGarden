// Live check of the workshop's Meta clients, one call each (about $0.02 of pictures):
//   set -a; . ~/.muse-garden.env; set +a; npx tsx server/adapters/meta/workshop.smoke.ts [out dir]
// Saves what came back in the out dir (default: <tmp>/meta-smoke) to look at, prints each reply's shape, and exits 1
// if any call failed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { metaImages } from './images';
import { metaJudge } from './judge';
import { metaSegmenter } from './sam';

if (!process.env.MODEL_API_KEY) {
  console.info('skipped: MODEL_API_KEY unset');
  process.exit(0);
}

const out = process.argv[2] ?? join(tmpdir(), 'meta-smoke');
mkdirSync(out, { recursive: true });
const base = readFileSync(fileURLToPath(new URL('../../workshop/body/base.jpg', import.meta.url)));

/** The reply's shape, long strings cut short: what the API really sends. */
function shape(v: unknown): unknown {
  if (typeof v === 'string') return v.length > 80 ? `${v.slice(0, 60)}… (${v.length} chars)` : v;
  if (Array.isArray(v)) return v.map(shape);
  if (typeof v === 'object' && v !== null) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]));
  return v;
}

const seen: typeof fetch = async (url, init) => {
  const res = await fetch(url, init);
  const text = await res.clone().text();
  let body: unknown = text.slice(0, 300);
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON: show the start
  }
  console.info(`\n${init?.method ?? 'GET'} ${typeof url === 'string' ? url : url instanceof URL ? url.href : url.url} → ${res.status}\n${JSON.stringify(shape(body), null, 1)}`);
  return res;
};

const size = async (b: Buffer) => {
  const m = await sharp(b).metadata();
  return `${m.width}×${m.height} ${m.format}, ${b.length} bytes`;
};

let failed = 0;
async function check(name: string, run: () => Promise<string>): Promise<void> {
  const t = Date.now();
  try {
    const said = await run();
    console.info(`\n✓ ${name} [${((Date.now() - t) / 1000).toFixed(1)} s]: ${said}`);
  } catch (e) {
    failed++;
    console.error(`\n✗ ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

const opts = { fetch: seen };
const images = metaImages(opts);
let edited: Buffer | null = null;

await check('muse-image-1.0 generation', async () => {
  const [picture] = await images.generate({ prompt: 'A tiny round planet covered in soft moss and pale blue flowers, a painted storybook style, on a plain cream background', n: 1, size: '1024x1024' });
  if (!picture) throw new Error('no picture');
  writeFileSync(join(out, 'generated.png'), picture);
  return `generated.png ${await size(picture)}`;
});

await check('muse-image-1.0 edit of base.jpg', async () => {
  const [picture] = await images.edit({ prompt: 'make the fur pale blue, keep everything else exactly the same', images: [base], n: 1 });
  if (!picture) throw new Error('no picture');
  edited = picture;
  writeFileSync(join(out, 'edited.png'), picture);
  return `edited.png ${await size(picture)} (base ${await size(base)})`;
});

await check('sam-3.1 "plush toy" on base.jpg', async () => {
  const found = await metaSegmenter(opts).find(base, 'plush toy');
  found.forEach((s, i) => s.mask && writeFileSync(join(out, `mask-${i}.png`), s.mask));
  return `${found.length} found: ${found.map((s, i) => `#${i} box ${s.box.join(',')} c=${s.confidence?.toFixed(3) ?? '-'} mask ${s.mask ? `mask-${i}.png` : 'none'}`).join('; ')}`;
});

await check('muse-spark-1.3 JSON with pictures', async () => {
  const schema = {
    type: 'object',
    properties: {
      fur_colour_before: { type: 'string' },
      fur_colour_after: { type: 'string' },
      same_pose: { type: 'boolean' },
      differences: { type: 'array', items: { type: 'string' } },
    },
    required: ['fur_colour_before', 'fur_colour_after', 'same_pose', 'differences'],
    additionalProperties: false,
  };
  const answer = await metaJudge(opts).json({
    name: 'smoke_compare',
    system: 'You compare two pictures of a plush mascot and answer in JSON.',
    prompt: 'The first picture is the original, the second an edit. What colour is the fur in each, is the pose the same, and what else differs?',
    images: edited ? [base, edited] : [base, base],
    schema,
  });
  return JSON.stringify(answer);
});

process.exit(failed > 0 ? 1 : 0);
