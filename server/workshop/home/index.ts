// The home pipeline: Muse's things drawn into its empty room, then made real one by one and stood in its hut.
//
// room      the hut's cutaway rendered with only the pieces a home keeps (the hearth, the bed, the showpiece), in
//           Muse's planet (its fork of the meadow) or, before there is one, in the meadow
// furnish   muse-image-1.0 draws Muse's things into it, three versions → Muse picks one
// pieces    sam-3.1 finds up to three of the things Muse named, each cropped and drawn again on its own on white
// mesh      each piece made into a model (Tripo, through the Mesher), one by one, cached by picture
// place     each stood where the picture has it, through the cutaway's camera, clear of what Muse needs; home.json
//           written into the fork
// show      the room rendered as furnished → Muse approves, or sends notes and it is furnished again
// Nothing found: one keepsake on the showpiece's shelf instead, from a find's picture.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import sharp from 'sharp';
import type { Box } from '../clients';
import { looksDir, museSlug } from '../body';
import { TripoBudget } from '../budget';
import type { Brief, JobRecord, PacketPicture, Pipeline, StageIO, StepOutcome, Verdict } from '../types';
import { furnishFork, type Home, type HomePiece } from './furnish';
import { glbSize, shrinkTextures } from './glb';
import { KEEP, keepsakeSpot, place, type RoomInfo } from './place';
import { browserRenderer, stubRenderer, type HomeRenderer } from './render';

/** At most this many pieces are made into models for one home (each is a paid run). */
export const MAX_PIECES = 3;
/** At most this many drafts of the room (Muse's notes start the next). */
const MAX_DRAFTS = 3;
/** How many versions of the furnished room Muse picks from. */
const VERSIONS = 3;
/** A crop round a found piece: this share of its size on each side, at least this many pixels. */
const PAD = { share: 0.12, min: 16 } as const;
/** The keepsake's height on the shelf (m). */
const KEEPSAKE_HEIGHT = 0.28;
/** A home piece's model at most this many faces (the meadow's stand-ins run about 64k each; the cutaway sees them small). */
const PIECE_FACES = 10_000;
/** A picture Muse linked to, fetched for a keepsake: how long and how big at most. */
const FETCH = { ms: 8000, bytes: 4 * 1024 * 1024 } as const;

interface Piece {
  readonly thing: string;
  /** Where it was found in the picked picture (pixels), and the picture's size; none for a keepsake. */
  readonly box: Box | null;
  readonly width: number;
  readonly height: number;
  /** Its own picture on white (a file in the job's folder). */
  readonly clean: string;
  /** Its model (a file in the job's folder) and its size as made, once made. */
  readonly glb?: string;
  readonly size?: { readonly x: number; readonly y: number; readonly z: number };
}

/** The job's working data (a type, not an interface, so it stands as the runner's plain record). */
type HomeData = {
  /** The draft being furnished (1 …), and Muse's notes for it. */
  readonly draft?: number;
  readonly notes?: readonly string[];
  /** The empty room: its picture (cropped to the room) and how the camera sees the floor in it. */
  readonly room?: { readonly file: string; readonly info: RoomInfo; readonly crop: { readonly left: number; readonly top: number; readonly width: number; readonly height: number } };
  readonly furnished?: readonly string[];
  readonly picked?: string;
  readonly pieces?: readonly Piece[];
  readonly keepsake?: boolean;
  /** Pieces that couldn't be made into models, and why. */
  readonly unmade?: readonly string[];
  readonly home?: Home;
  /** Where the home was written: the fork, or a folder in the job waiting for one. */
  readonly installed?: { readonly fork: boolean; readonly path: string };
};

const data = (job: JobRecord): HomeData => job.data;

/** Muse's planet: the meadow's fork the planet workshop makes for it. */
export const forkFor = (repo: string, museId: string): string => join(repo, 'environments', `muse-${museId}`);
const isWorld = (dir: string): boolean => existsSync(join(dir, 'world.ts'));

/**
 * A home finished before its Muse had a planet waits in its job's folder (home/home.json and its models). Once the
 * planet is forked, this puts every such home in it, the latest last; true if one went in.
 */
export function furnishWaitingHomes(repo: string, museId: string, jobDirs: readonly string[]): boolean {
  const fork = forkFor(repo, museId);
  if (!isWorld(fork)) return false;
  let put = false;
  for (const dir of jobDirs) {
    const kit = join(dir, 'home');
    const file = join(kit, 'home.json');
    if (!existsSync(file)) continue;
    furnishFork(fork, JSON.parse(readFileSync(file, 'utf8')) as Home, kit);
    put = true;
  }
  return put;
}

/** Muse's own body for the rendered room: the newest the body workshop made it (gen-<muse>-<n> with its model made), else none. */
export function madeLook(io: StageIO, museId: string): string | undefined {
  const dir = looksDir(io);
  if (!existsSync(dir)) return undefined;
  const own = new RegExp(`^gen-${museSlug(museId)}-(\\d+)\\.glb$`);
  const n = Math.max(0, ...readdirSync(dir).map((f) => Number(own.exec(f)?.[1] ?? 0)));
  return n > 0 ? `gen-${museSlug(museId)}-${n}` : undefined;
}

/** The things Muse named (3–6 asked for), as given. */
function thingsOf(brief: Brief): string[] {
  return (brief.things ?? []).map((t) => t.trim()).filter((t) => t.length > 0).slice(0, 6);
}

/** A thing as sam-3.1 takes it: a short noun phrase ("a big green armchair by the fire" → "big green armchair"). */
export function nounPhrase(thing: string): string {
  const words = thing
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .split(/\s+(?:by|on|in|near|next|with|for|under|beside|against|from|at|that|which|where)\s+/)[0]
    .split(/\s+/)
    .filter((w) => w && !['a', 'an', 'the', 'some', 'my', 'its', 'his', 'her', 'their', 'our'].includes(w));
  return words.slice(-4).join(' ') || thing.trim();
}

/** A thing as Muse reads it back: its own words up to what it stands by or comes with, what it stands on kept ("a record player with a small stack of jazz records" → "a record player", "a kettle on a little stove" as it is). */
export function shortName(thing: string): string {
  const name = thing
    .trim()
    .replace(/[\s.,;:!?]+$/, '')
    .split(/\s+(?:by|in|near|next|with|for|under|beside|against|from|at|that|which|where)\s+/i)[0]
    .replace(/^(?:A|An|The|Some|My)\b/, (w) => w.toLowerCase());
  return name || thing.trim();
}

/** "a, b and c". */
const listed = (items: readonly string[]): string => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

function furnishPrompt(brief: Brief, things: readonly string[], notes: readonly string[]): string {
  const lines = [
    'Furnish this room seen from above through a cutaway, the home of Muse, a small round plush creature.',
    'Keep everything already there exactly as it is: the camera and framing, the walls, the plank floor, the rug, the hearth and its fire, the bed, the tall cabinet on the left wall, the light and the painterly style.',
    `Add these things, each standing on the floor, whole, clearly separate from one another and from the walls, not overlapping anything: ${things.join('; ')}.`,
    'Leave the floor clear in front of the hearth, beside the bed and just inside the front door.',
  ];
  if (brief.text.trim()) lines.push(`How it should feel: ${brief.text.trim()}`);
  if (brief.must?.length) lines.push(`It must have: ${brief.must.join('; ')}.`);
  if (brief.never?.length) lines.push(`Never: ${brief.never.join('; ')}.`);
  if (notes.length) lines.push(`Muse's notes on the last version: ${notes.join(' / ')}`);
  lines.push('No people, no text, no watermark.');
  return lines.join('\n');
}

/** image-blaster's isolation prompt, for one thing cut out of the furnished room. */
function isolatePrompt(thing: string): string {
  return [
    `Isolate the ${thing} from this image. Reproduce it exactly as shown -- same colors, materials, and proportions.`,
    'White background, centered, tight crop, studio lighting. No other objects, no scene, no people, no text, no shadows on the ground.',
    'Isolate the object and remove all clustered, adjacent, overlapping, or items resting on the target object.',
    'Show the whole object from the front and a little to one side, at about eye level, as a product photo, nothing cut off. Create a clean render of that one single object that is true to the source image.',
  ].join(' ');
}

function keepsakePrompt(brief: Brief): string {
  return [
    'Make one small keepsake from this picture, something Muse would keep on a shelf to remember it by: a single small object (a figurine, a little model or an ornament) that sums up what the picture shows.',
    brief.text.trim() ? `Muse says: ${brief.text.trim()}` : '',
    'One single object, whole, centered on a plain white background, studio lighting, no text, no shadows on the ground.',
  ]
    .filter(Boolean)
    .join(' ');
}

const png = (image: Buffer): Promise<Buffer> => sharp(image).png().toBuffer();

/** The picture cropped to the room: its floor's corners and the walls' height over them (the camera's samples), with a margin; and the samples moved into the crop. */
async function cropToRoom(image: Buffer, info: RoomInfo): Promise<{ png: Buffer; info: RoomInfo; crop: { left: number; top: number; width: number; height: number } }> {
  const meta = await sharp(image).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;
  const floor = info.samples.filter((s) => s.y === 0);
  const up = info.samples.filter((s) => s.y === 1);
  const points = floor.flatMap((s) => {
    const o = up.find((t) => t.x === s.x && t.z === s.z);
    // (the walls stand 2.7 m over the floor: a metre up, drawn on 2.8 times)
    return o ? [[s.u, s.v], [s.u + 2.8 * (o.u - s.u), s.v + 2.8 * (o.v - s.v)]] : [[s.u, s.v]];
  });
  const margin = 0.04;
  const u0 = Math.max(0, Math.min(...points.map((p) => p[0])) - margin);
  const u1 = Math.min(1, Math.max(...points.map((p) => p[0])) + margin);
  const v0 = Math.max(0, Math.min(...points.map((p) => p[1])) - margin);
  const v1 = Math.min(1, Math.max(...points.map((p) => p[1])) + margin);
  const crop = { left: Math.round(u0 * W), top: Math.round(v0 * H), width: Math.max(1, Math.round((u1 - u0) * W)), height: Math.max(1, Math.round((v1 - v0) * H)) };
  const out = await sharp(image).extract(crop).png().toBuffer();
  const moved = info.samples.map((s) => ({ ...s, u: (s.u * W - crop.left) / crop.width, v: (s.v * H - crop.top) / crop.height }));
  return { png: out, info: { ...info, samples: moved }, crop };
}

/** A box grown by PAD on each side, kept within the picture. */
function padded(box: Box, width: number, height: number): { left: number; top: number; width: number; height: number } {
  const [x1, y1, x2, y2] = box;
  const px = Math.max(PAD.min, (x2 - x1) * PAD.share);
  const py = Math.max(PAD.min, (y2 - y1) * PAD.share);
  const left = Math.max(0, Math.floor(x1 - px));
  const top = Math.max(0, Math.floor(y1 - py));
  return { left, top, width: Math.max(1, Math.min(width, Math.ceil(x2 + px)) - left), height: Math.max(1, Math.min(height, Math.ceil(y2 + py)) - top) };
}

function overlap(a: Box, b: Box): number {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const area = (r: Box): number => (r[2] - r[0]) * (r[3] - r[1]);
  return (w * h) / Math.max(1e-9, area(a) + area(b) - w * h);
}

const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'piece';

/** The first picture Muse linked to that can be fetched (a data: URL or an http(s) link), else null. */
async function referencePicture(brief: Brief, signal: AbortSignal): Promise<Buffer | null> {
  for (const ref of brief.references ?? []) {
    try {
      if (ref.startsWith('data:image/')) return Buffer.from(ref.slice(ref.indexOf(',') + 1), 'base64');
      if (!/^https?:\/\//.test(ref)) continue;
      const res = await fetch(ref, { signal: AbortSignal.any([signal, AbortSignal.timeout(FETCH.ms)]) });
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > 0 && bytes.length <= FETCH.bytes) return bytes;
    } catch {
      // (a link that won't open is passed over)
    }
  }
  return null;
}

const read = (io: StageIO, file: string): Buffer => readFileSync(join(io.dir, file));
const write = (io: StageIO, file: string, bytes: Buffer): void => {
  mkdirSync(io.dir, { recursive: true });
  writeFileSync(join(io.dir, file), bytes);
};
const made = (io: StageIO, file: string): boolean => existsSync(join(io.dir, file));
const pagePath = (repo: string, fork: string): string => `/${relative(repo, fork).split('\\').join('/')}/`;

export interface HomeOptions {
  /** How the room is rendered (default: the dev server in headless Chromium; a stand-in under WORKSHOP_FAKE=1). */
  readonly renderer?: (io: StageIO) => HomeRenderer;
}

export function makeHomePipeline(opts: HomeOptions = {}): Pipeline {
  const renderer = opts.renderer ?? ((io: StageIO) => (process.env.WORKSHOP_FAKE === '1' ? stubRenderer() : browserRenderer(io.devServer)));

  const steps: Record<string, (job: JobRecord, io: StageIO) => Promise<StepOutcome>> = {
    async room(job, io) {
      const d = data(job);
      if (thingsOf(job.brief).length === 0 && !job.brief.text.trim()) return { kind: 'failed', message: 'Say what you’d like in your home: 3 to 6 things, and how it should feel.' };
      if (d.room && made(io, d.room.file)) return { kind: 'continue', stage: 'furnish', data: d };
      const fork = forkFor(io.repo, job.museId);
      const page = isWorld(fork) ? pagePath(io.repo, fork) : '/';
      io.log(`rendering the empty room in ${page}`);
      const shot = await renderer(io).room({ page, keep: KEEP, look: madeLook(io, job.museId), signal: io.signal });
      const room = await cropToRoom(shot.png, shot.info);
      write(io, 'room.png', room.png);
      return { kind: 'continue', stage: 'furnish', data: { ...d, draft: d.draft ?? 1, room: { file: 'room.png', info: room.info, crop: room.crop } }, message: 'The empty room is drawn; furnishing it.' };
    },

    async furnish(job, io) {
      const d = data(job);
      const draft = d.draft ?? 1;
      const room = read(io, d.room!.file);
      const files = Array.from({ length: VERSIONS }, (_, k) => `furnish-${draft}-${k + 1}.png`);
      if (!files.every((f) => made(io, f))) {
        const { width, height } = await sharp(room).metadata();
        const things = thingsOf(job.brief);
        const out = await io.clients.images.edit({ prompt: furnishPrompt(job.brief, things.length ? things : [job.brief.text.trim()], d.notes ?? []), images: [room], n: VERSIONS, signal: io.signal });
        if (out.length === 0) return { kind: 'failed', message: 'The room couldn’t be furnished: the picture service sent nothing back.' };
        // (each the empty room's size, so its floor lies where the camera put it)
        for (const [k, file] of files.entries()) write(io, file, await sharp(out[k % out.length]).resize(width, height, { fit: 'fill' }).png().toBuffer());
      }
      const pictures: PacketPicture[] = files.map((file, k) => ({ id: file.replace(/\.png$/, ''), path: io.url(file), caption: `Version ${k + 1} of your room${draft > 1 ? `, draft ${draft}` : ''}` }));
      return {
        kind: 'wait',
        stage: 'pick',
        data: { ...d, draft, furnished: files },
        packet: {
          stage: 'pick',
          ask: 'pick',
          text: `Your room, furnished three ways with ${thingsOf(job.brief).join(', ') || 'what you described'}. Pick the one that feels like home; up to ${MAX_PIECES} of its things will be made real and stood in your hut.`,
          pictures,
          pick: { min: 1, max: 1 },
        },
      };
    },

    async pieces(job, io) {
      const d = data(job);
      const draft = d.draft ?? 1;
      const picked = read(io, d.picked!);
      const { width = 1, height = 1 } = await sharp(picked).metadata();
      const pieces: Piece[] = [];
      for (const thing of thingsOf(job.brief)) {
        if (pieces.length >= MAX_PIECES) break;
        const found = await io.clients.segmenter.find(picked, nounPhrase(thing), io.signal);
        const best = [...found]
          .map((s) => ({ ...s, box: [Math.max(0, s.box[0]), Math.max(0, s.box[1]), Math.min(width - 1, s.box[2]), Math.min(height - 1, s.box[3])] as const }))
          .filter((s) => s.box[2] - s.box[0] >= 8 && s.box[3] - s.box[1] >= 8 && pieces.every((p) => !p.box || overlap(p.box, s.box) < 0.6))
          .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
        if (!best) {
          io.log(`no ${nounPhrase(thing)} found in the picked room`);
          continue;
        }
        const n = pieces.length + 1;
        const crop = `crop-${draft}-${n}.png`;
        const clean = `piece-${draft}-${n}.png`;
        if (!made(io, crop)) write(io, crop, await sharp(picked).extract(padded(best.box, width, height)).png().toBuffer());
        if (!made(io, clean)) {
          const [out] = await io.clients.images.edit({ prompt: isolatePrompt(thing), images: [read(io, crop)], n: 1, signal: io.signal });
          if (!out) continue;
          write(io, clean, await sharp(out).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png().toBuffer());
        }
        pieces.push({ thing, box: best.box, width, height, clean });
      }
      if (pieces.length === 0) return { kind: 'continue', stage: 'keepsake', data: { ...d, pieces: [] }, message: 'None of your things could be found in the picture; making a keepsake instead.' };
      return { kind: 'continue', stage: 'mesh', data: { ...d, pieces, keepsake: false }, message: `Found ${pieces.map((p) => p.thing).join(', ')}; making them real one by one.` };
    },

    async keepsake(job, io) {
      const d = data(job);
      const draft = d.draft ?? 1;
      const clean = `keepsake-${draft}.png`;
      if (!made(io, clean)) {
        const source = (await referencePicture(job.brief, io.signal)) ?? read(io, d.picked ?? d.room!.file);
        const [out] = await io.clients.images.edit({ prompt: keepsakePrompt(job.brief), images: [await png(source)], n: 1, signal: io.signal });
        if (!out) return { kind: 'failed', message: 'The keepsake couldn’t be drawn: the picture service sent nothing back.' };
        write(io, clean, await sharp(out).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).png().toBuffer());
      }
      return { kind: 'continue', stage: 'mesh', data: { ...d, keepsake: true, pieces: [{ thing: 'keepsake', box: null, width: 0, height: 0, clean }] } };
    },

    async mesh(job, io) {
      const d = data(job);
      const cache = join(io.repo, '.muse', 'workshop', 'home-meshes');
      const pieces: Piece[] = [];
      const unmade: string[] = [];
      // (one by one: each is a paid run, cached by its picture so the same picture is never paid for twice)
      for (const [k, p] of (d.pieces ?? []).slice(0, MAX_PIECES).entries()) {
        const file = `home-${k + 1}-${slug(p.thing)}.glb`;
        try {
          if (!made(io, file)) {
            const picture = read(io, p.clean);
            const cached = join(cache, `${TripoBudget.hash(picture)}.glb`);
            if (!existsSync(cached)) {
              const model = await io.clients.mesher.fromImage(picture, { faceLimit: PIECE_FACES, purpose: `home piece ${p.thing} for ${job.museId}` }, io.signal);
              mkdirSync(cache, { recursive: true });
              writeFileSync(cached, await shrinkTextures(model));
            }
            copyFileSync(cached, join(io.dir, file));
          }
          pieces.push({ ...p, glb: file, size: glbSize(read(io, file)) });
        } catch (error) {
          if (io.signal.aborted) throw error;
          unmade.push(`${p.thing}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (pieces.length === 0) return { kind: 'failed', message: `None of the pieces could be made in 3D (${unmade.join('; ')}).` };
      return { kind: 'continue', stage: 'place', data: { ...d, pieces, unmade }, message: `${pieces.length} piece${pieces.length === 1 ? '' : 's'} made; standing them in the room.` };
    },

    place(job, io) {
      const d = data(job);
      const info = d.room!.info;
      const ready = (d.pieces ?? []).filter((p): p is Piece & { glb: string; size: NonNullable<Piece['size']> } => !!p.glb && !!p.size);
      let pieces: HomePiece[] = [];
      if (!d.keepsake) {
        const spots = place(
          ready.map((p) => ({ name: p.thing, box: p.box!, width: p.width, height: p.height, model: p.size })),
          info,
        );
        pieces = ready.flatMap((p, k) => {
          const s = spots[k];
          return s ? [{ name: `home-${slug(p.thing)}`, file: p.glb, height: s.height, place: { x: s.x, z: s.z, turn: s.turn } }] : [];
        });
      }
      // (a keepsake, or nothing found room for on the floor: the first piece small on the showpiece's shelf)
      if (pieces.length === 0 && ready[0]) {
        const spot = keepsakeSpot(info, KEEPSAKE_HEIGHT);
        pieces = [{ name: 'keepsake', file: ready[0].glb, height: KEEPSAKE_HEIGHT, place: { x: spot.x, z: spot.z, turn: spot.turn }, lift: spot.lift, rests: false }];
      }
      const home: Home = { keep: [...KEEP], pieces };
      const fork = forkFor(io.repo, job.museId);
      let installed: HomeData['installed'];
      if (isWorld(fork)) {
        furnishFork(fork, home, io.dir);
        installed = { fork: true, path: fork };
      } else {
        // (no planet yet: the home waits in the job's folder, for furnishFork once the planet is forked)
        const kit = join(io.dir, 'home');
        mkdirSync(kit, { recursive: true });
        for (const p of pieces) copyFileSync(join(io.dir, p.file), join(kit, p.file));
        writeFileSync(join(kit, 'home.json'), `${JSON.stringify(home, null, 2)}\n`);
        installed = { fork: false, path: kit };
      }
      return Promise.resolve({ kind: 'continue', stage: 'show', data: { ...d, home, installed } });
    },

    async show(job, io) {
      const d = data(job);
      const draft = d.draft ?? 1;
      const file = `home-${draft}.png`;
      const where = d.installed!;
      if (where.fork && !made(io, file)) {
        const shot = await renderer(io).furnished({ page: pagePath(io.repo, where.path), look: madeLook(io, job.museId), signal: io.signal });
        write(io, file, await sharp(shot).extract(d.room!.crop).png().toBuffer());
      }
      const pieces = d.home?.pieces ?? [];
      // (each piece by the thing Muse named, not its file's name, which is cut short)
      const nameOf = (p: HomePiece): string => {
        const thing = d.pieces?.find((q) => q.glb === p.file)?.thing;
        return thing ? shortName(thing) : p.name.replace(/^home-/, '').replace(/-/g, ' ');
      };
      const pictures: PacketPicture[] = [
        ...(where.fork ? [{ id: `home-${draft}`, path: io.url(file), caption: 'Your room as it stands now' }] : [{ id: d.picked!.replace(/\.png$/, ''), path: io.url(d.picked!), caption: 'The room you picked' }]),
        ...(d.pieces ?? []).map((p) => ({ id: p.clean.replace(/\.png$/, ''), path: io.url(p.clean), caption: p.thing })),
      ];
      const checklist = [
        ...pieces.map((p) => ({ item: nameOf(p), ok: true, note: p.rests === false ? 'on the showpiece’s shelf' : `stands ${p.height} m tall` })),
        ...(d.unmade ?? []).map((u) => ({ item: u.split(':')[0], ok: false, note: `couldn’t be made: ${u.slice(u.indexOf(':') + 1).trim()}` })),
      ];
      const lastDraft = draft >= MAX_DRAFTS;
      return {
        kind: 'wait',
        stage: 'approve',
        data: d,
        packet: {
          stage: 'approve',
          ask: 'approve',
          text: [
            d.keepsake ? 'None of your things could be found in the picture, so here is a keepsake for your showpiece’s shelf.' : `Your home, with ${listed(pieces.map(nameOf))} stood in it.`,
            where.fork ? '' : 'Your planet isn’t made yet, so the room can’t be drawn; it goes in as soon as it is.',
            lastDraft ? 'This is the last draft: approve it to keep it.' : 'Approve it, or send up to 3 notes and the room is furnished again.',
          ]
            .filter(Boolean)
            .join(' '),
          pictures,
          checklist,
        },
      };
    },

    finish(job, io) {
      const d = data(job);
      const where = { ...d.installed!, path: relative(io.repo, d.installed!.path) || '.' };
      const n = d.home?.pieces.length ?? 0;
      return Promise.resolve({
        kind: 'done',
        data: d,
        result: {},
        message: where.fork
          ? `Muse’s home is furnished: ${n} piece${n === 1 ? '' : 's'} in ${where.path}/ (home.json, assets/home/).`
          : `Muse’s home is ready (${n} piece${n === 1 ? '' : 's'}) and waits in ${where.path}/ for its planet: furnishFork puts it in.`,
      });
    },
  };

  return {
    kind: 'home',
    firstStage: 'room',
    step(job, io) {
      const run = steps[job.stage];
      return run ? run(job, io) : Promise.resolve({ kind: 'failed', message: `The home workshop has no step "${job.stage}".` });
    },
    answer(job, verdict: Verdict) {
      const d = data(job);
      if (job.stage === 'pick') {
        const ids = (d.furnished ?? []).map((f) => f.replace(/\.png$/, ''));
        const pick = verdict.picks?.[0];
        if (verdict.picks?.length !== 1 || !pick || !ids.includes(pick)) return { ok: false, error: `Pick one of the rooms: ${ids.join(', ')}.` };
        return { ok: true, stage: 'pieces', data: { ...d, picked: `${pick}.png`, pieces: undefined, home: undefined, installed: undefined, unmade: undefined, keepsake: undefined } };
      }
      if (job.stage === 'approve') {
        if (verdict.approve) return { ok: true, stage: 'finish', data: d };
        const notes = (verdict.notes ?? []).map((n) => n.text.trim()).filter(Boolean);
        if (notes.length === 0) return { ok: false, error: 'Approve the room, or send up to 3 notes on what to change.' };
        if (notes.length > 3) return { ok: false, error: 'At most 3 notes.' };
        const draft = d.draft ?? 1;
        if (draft >= MAX_DRAFTS) return { ok: false, error: `That was the last of ${MAX_DRAFTS} drafts: approve it to keep it.` };
        return { ok: true, stage: 'furnish', data: { ...d, draft: draft + 1, notes, furnished: undefined, picked: undefined, pieces: undefined, home: undefined, unmade: undefined, keepsake: undefined } };
      }
      return { ok: false, error: 'Nothing is waiting for an answer here.' };
    },
    estimateMs(stage) {
      return { room: 60_000, furnish: 90_000, pieces: 120_000, keepsake: 60_000, mesh: 300_000, place: 2_000, show: 60_000, finish: 1_000 }[stage] ?? 60_000;
    },
  };
}

export const homePipeline: Pipeline = makeHomePipeline();
