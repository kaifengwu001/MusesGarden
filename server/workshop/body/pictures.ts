// The body's pictures: concepts fitted to the base's size, contact sheets, the portrait, the avatar decoded.
import sharp from 'sharp';
import type { Box } from '../clients';

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 } as const;

/** A picture at exactly `width`×`height` (letterboxed on white if its shape differs), as PNG. */
export function fitTo(image: Buffer, width: number, height: number): Promise<Buffer> {
  return sharp(image).resize(width, height, { fit: 'contain', background: WHITE }).flatten({ background: WHITE }).png().toBuffer();
}

/** The avatar from its data: URL, as PNG at most 1024 on a side, or null if it isn't one. */
export async function avatarPicture(dataUrl: string): Promise<Buffer | null> {
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/is.exec(dataUrl.trim());
  if (!m) return null;
  try {
    return await sharp(Buffer.from(m[1], 'base64')).resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).flatten({ background: WHITE }).png().toBuffer();
  } catch {
    return null;
  }
}

const escape = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Pictures side by side in rows of `columns`, each `tile` tall, with its label under it, as JPEG. */
export async function contactSheet(items: readonly { readonly image: Buffer; readonly label: string }[], columns = 4, tile = 420): Promise<Buffer> {
  const label = 34;
  const gap = 12;
  const tiles = await Promise.all(items.map((it) => sharp(it.image).resize({ height: tile, width: tile, fit: 'contain', background: WHITE }).flatten({ background: WHITE }).png().toBuffer()));
  const cols = Math.max(1, Math.min(columns, items.length));
  const rows = Math.max(1, Math.ceil(items.length / cols));
  const width = cols * tile + (cols + 1) * gap;
  const height = rows * (tile + label) + (rows + 1) * gap;
  const layers = items.flatMap((it, i) => {
    const left = gap + (i % cols) * (tile + gap);
    const top = gap + Math.floor(i / cols) * (tile + label + gap);
    const text = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${tile}" height="${label}"><text x="${tile / 2}" y="${label - 9}" font-family="Helvetica, Arial, sans-serif" font-size="22" text-anchor="middle" fill="#333">${escape(it.label)}</text></svg>`,
    );
    return [
      { input: tiles[i], left, top },
      { input: text, left, top: top + tile },
    ];
  });
  return sharp({ create: { width, height, channels: 3, background: WHITE } }).composite(layers).jpeg({ quality: 88 }).toBuffer();
}

/** A square portrait round the face (its box, or the top middle when there's none), 512 on a side, as JPEG. */
export async function portrait(image: Buffer, face: Box | null): Promise<Buffer> {
  const meta = await sharp(image).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const [cx, cy, size] = face ? [(face[0] + face[2]) / 2, (face[1] + face[3]) / 2, 2.2 * Math.max(face[2] - face[0], face[3] - face[1])] : [W / 2, H * 0.35, W * 0.5];
  const side = Math.round(Math.max(16, Math.min(size, W, H)));
  const left = Math.round(Math.min(Math.max(0, cx - side / 2), W - side));
  const top = Math.round(Math.min(Math.max(0, cy - side / 2), H - side));
  return sharp(image).extract({ left, top, width: side, height: side }).resize(512, 512).flatten({ background: WHITE }).jpeg({ quality: 90 }).toBuffer();
}
