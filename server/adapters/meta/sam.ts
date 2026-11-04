// sam-3.1 as the workshop's Segmenter: POST /v1/responses with one short noun phrase and one picture; every match
// comes back as a record `<id><|box;x1;y1;x2;y2;w;h;c|><|mask;x=0;y=0;c;data=H,W,!payload|>` in one output_text line.
// Docs: https://dev.meta.ai/docs/sam/segmenting and /docs/sam/reading-segmentation. Boxes are inclusive source
// pixels; a mask is an H×W raster over its box (H = y2-y1+1, W = x2-x1+1, seen live), base85 and range coded. The
// docs don't spell that coding out, so masks are decoded by Meta's own parser, @meta-sam/parser (decodeMaskToRaster),
// when it's installed or passed in; without it, segments carry their box and a null mask.
import sharp from 'sharp';
import type { Box, Segment, Segmenter } from '../../workshop/clients';
import type { MetaOptions } from './http';
import { dataUrl, isRecord, metaHttp } from './http';

export const SAM_MODEL = 'sam-3.1';
const TIMEOUT_MS = 60_000;
const PARSER = '@meta-sam/parser';

/** One mask as sent: its coding, payload (with its ! or ~ marker) and raster size. */
export interface WireMask {
  readonly encoding: 'one_bit' | 'lossless';
  readonly payload: string;
  readonly width: number;
  readonly height: number;
}

/** Decodes a mask to a row-major raster of 0 and 1, width × height long (decodeMaskToRaster's contract). */
export type MaskDecoder = (mask: WireMask) => Uint8Array;

export interface MetaSamOptions extends MetaOptions {
  readonly model?: string;
  readonly timeoutMs?: number;
  /** Defaults to @meta-sam/parser's decodeMaskToRaster if it's installed; null means boxes only. */
  readonly decodeMask?: MaskDecoder | null;
}

/** One match as read off the wire, before its mask is drawn. */
export interface SamRecord {
  readonly id: number;
  readonly box: Box;
  /** The source size the box is in (the picture's). */
  readonly size: readonly [w: number, h: number];
  readonly confidence?: number;
  readonly mask: WireMask | null;
}

const TOKEN = /<\|([A-Za-z][A-Za-z0-9_.-]*)(?:;([^|]*))?\|>/y;
const RECORD = /,?\s*([0-9]+)(?=<\|)/y;

function fields(body: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (body ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return out;
}

const int = (v: string | undefined): number | null => (v !== undefined && /^-?[0-9]+$/.test(v) ? Number(v) : null);

/** Every record in sam-3.1's output text (one line per frame; a picture has one, `<0f>`). Bad records are skipped. */
export function parseSamText(text: string): SamRecord[] {
  const out: SamRecord[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const header = /^<\d+f(?:;[^>]*)?>/.exec(line);
    if (!header) continue;
    let at = header[0].length;
    while (at < line.length) {
      RECORD.lastIndex = at;
      const rec = RECORD.exec(line);
      if (!rec) break;
      at = RECORD.lastIndex;
      let box: Map<string, string> | null = null;
      let mask: Map<string, string> | null = null;
      for (;;) {
        TOKEN.lastIndex = at;
        const tok = TOKEN.exec(line);
        if (!tok) break;
        at = TOKEN.lastIndex;
        if (tok[1] === 'box') box = fields(tok[2]);
        else if (tok[1] === 'mask') mask = fields(tok[2]);
      }
      if (!box) continue;
      const nums = ['x1', 'y1', 'x2', 'y2', 'w', 'h'].map((k) => int(box.get(k)));
      if (!nums.every((v): v is number => v !== null)) continue;
      const [x1 = 0, y1 = 0, x2 = 0, y2 = 0, w = 0, h = 0] = nums;
      const c = Number(box.get('c'));
      const data = /^([0-9]+),([0-9]+),([!~][^|]*)$/.exec(mask?.get('data') ?? '');
      out.push({
        id: Number(rec[1]),
        box: [x1, y1, x2, y2],
        size: [w, h],
        ...(box.has('c') && Number.isFinite(c) ? { confidence: c } : {}),
        mask: data
          ? { encoding: data[3]?.startsWith('~') ? 'lossless' : 'one_bit', payload: data[3] ?? '', height: Number(data[1]), width: Number(data[2]) }
          : null,
      });
    }
  }
  return out;
}

/** The output_text of a /v1/responses reply (every message's text parts, joined by lines). */
export function outputText(reply: unknown): string {
  if (!isRecord(reply)) return '';
  if (typeof reply.output_text === 'string') return reply.output_text;
  const parts: string[] = [];
  for (const item of Array.isArray(reply.output) ? (reply.output as unknown[]) : []) {
    if (!isRecord(item) || item.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const c of item.content as unknown[]) if (isRecord(c) && c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
  }
  return parts.join('\n');
}

/** A record's mask as a PNG the picture's size: white inside, black outside. */
export async function maskPng(rec: SamRecord, raster: Uint8Array, width: number, height: number): Promise<Buffer> {
  if (!rec.mask) throw new Error('no mask');
  const sx = width / rec.size[0];
  const sy = height / rec.size[1];
  const [x1, y1, x2, y2] = rec.box;
  const left = Math.round(x1 * sx);
  const top = Math.round(y1 * sy);
  const boxW = Math.max(1, Math.round((x2 + 1) * sx) - left);
  const boxH = Math.max(1, Math.round((y2 + 1) * sy) - top);
  const { width: mw, height: mh } = rec.mask;
  let cells = Buffer.alloc(mw * mh);
  for (let i = 0; i < cells.length; i++) cells[i] = raster[i] ? 255 : 0;
  if (mw !== boxW || mh !== boxH) {
    cells = await sharp(cells, { raw: { width: mw, height: mh, channels: 1 } }).resize(boxW, boxH, { kernel: 'nearest', fit: 'fill' }).raw().toBuffer();
  }
  const full = Buffer.alloc(width * height);
  for (let y = 0; y < boxH; y++) {
    const fy = top + y;
    if (fy < 0 || fy >= height) continue;
    for (let x = 0; x < boxW; x++) {
      const fx = left + x;
      if (fx >= 0 && fx < width) full[fy * width + fx] = cells[y * boxW + x] ?? 0;
    }
  }
  return sharp(full, { raw: { width, height, channels: 1 } }).png().toBuffer();
}

let parserDecoder: Promise<MaskDecoder | null> | null = null;
/** @meta-sam/parser's decoder, if it's installed. Looked up once. */
function installedDecoder(): Promise<MaskDecoder | null> {
  parserDecoder ??= (import(PARSER) as Promise<{ decodeMaskToRaster?: MaskDecoder }>).then(
    (m) => (typeof m.decodeMaskToRaster === 'function' ? m.decodeMaskToRaster : null),
    () => {
      console.warn(`sam-3.1: ${PARSER} isn’t installed, so segments carry boxes only (mask null)`);
      return null;
    },
  );
  return parserDecoder;
}

export function metaSegmenter(opts: MetaSamOptions = {}): Segmenter {
  const http = metaHttp(opts);
  const model = opts.model ?? SAM_MODEL;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;

  return {
    async find(image, phrase, signal) {
      const what = `Finding “${phrase}” (sam-3.1)`;
      const body = {
        model,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: phrase },
              { type: 'input_image', image_url: dataUrl(image) },
            ],
          },
        ],
        metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
      };
      const reply = await http.post('/responses', body, { what, timeoutMs, signal });
      if (isRecord(reply) && reply.status !== undefined && reply.status !== 'completed') {
        throw new Error(`${what} didn’t finish (${JSON.stringify(reply.status)})`);
      }
      const records = parseSamText(outputText(reply));
      if (records.length === 0) return [];
      const decode = opts.decodeMask === undefined ? await installedDecoder() : opts.decodeMask;
      const meta = await sharp(image).metadata();
      const width = meta.width ?? records[0]?.size[0] ?? 0;
      const height = meta.height ?? records[0]?.size[1] ?? 0;
      return Promise.all(
        records.map(async (rec): Promise<Segment> => {
          const sx = width / rec.size[0];
          const sy = height / rec.size[1];
          const [x1, y1, x2, y2] = rec.box;
          const box: Box = sx === 1 && sy === 1 ? rec.box : [Math.round(x1 * sx), Math.round(y1 * sy), Math.round(x2 * sx), Math.round(y2 * sy)];
          let mask: Buffer | null = null;
          if (decode && rec.mask) {
            try {
              mask = await maskPng(rec, decode(rec.mask), width, height);
            } catch (e) {
              console.warn(`${what}: a mask couldn’t be decoded (${e instanceof Error ? e.message : String(e)}), keeping its box`);
            }
          }
          return { box, mask, ...(rec.confidence === undefined ? {} : { confidence: rec.confidence }) };
        }),
      );
    },
  };
}
