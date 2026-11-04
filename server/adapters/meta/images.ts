// muse-image-1.0 as the workshop's ImageGen: /v1/images/generations and /v1/images/edits (JSON body, `images` as
// data URLs, the picture being edited first). Docs: dev.meta.ai (its images guide) and the Images API
// schemas. Pictures come back as PNG bytes; `size` only sets the aspect ratio (the resolution is the model's).
import sharp from 'sharp';
import type { ImageGen } from '../../workshop/clients';
import type { MetaOptions } from './http';
import { dataUrl, isPng, isRecord, metaHttp } from './http';

export const IMAGE_MODEL = 'muse-image-1.0';
const TIMEOUT_MS = 120_000;
const MAX_N = 10;
const MAX_INPUTS = 10;
/** Search, browsing and code off: a picture made from the prompt (and inputs) alone, sooner. */
const NO_TOOLS = { enable_image_search: false, enable_web_search: false, enable_shell: false } as const;

export interface MetaImagesOptions extends MetaOptions {
  readonly model?: string;
  readonly timeoutMs?: number;
}

export function metaImages(opts: MetaImagesOptions = {}): ImageGen {
  const http = metaHttp(opts);
  const model = opts.model ?? IMAGE_MODEL;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const fetchUrl = opts.fetch ?? fetch.bind(globalThis);

  async function pictures(reply: unknown, n: number, what: string, signal?: AbortSignal): Promise<Buffer[]> {
    const data = isRecord(reply) && Array.isArray(reply.data) ? (reply.data as unknown[]) : null;
    if (!data) throw new Error(`${what} answered without any pictures`);
    const out: Buffer[] = [];
    for (const item of data) {
      if (!isRecord(item)) continue;
      if (typeof item.b64_json === 'string') out.push(Buffer.from(item.b64_json, 'base64'));
      else if (typeof item.url === 'string') {
        const res = await fetchUrl(item.url, { signal: AbortSignal.any([AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]) });
        if (!res.ok) throw new Error(`${what}: a picture's link answered ${res.status}`);
        out.push(Buffer.from(await res.arrayBuffer()));
      }
    }
    if (out.length === 0) throw new Error(`${what} answered without any pictures`);
    if (out.length < n) console.warn(`${what}: asked for ${n} pictures, got ${out.length}`);
    return Promise.all(out.map((b) => (isPng(b) ? Promise.resolve(b) : sharp(b).png().toBuffer())));
  }

  const count = (n: number): number => {
    if (!Number.isInteger(n) || n < 1 || n > MAX_N) throw new Error(`muse-image-1.0 makes 1 to ${MAX_N} pictures at a time (asked for ${n})`);
    return n;
  };

  return {
    async generate({ prompt, n, size, search, signal }) {
      const what = 'Making pictures (muse-image-1.0)';
      const body = {
        model,
        prompt,
        n: count(n),
        ...(size ? { size } : {}),
        response_format: 'b64_json',
        output_format: 'png',
        ...(search ? {} : { tool_enablement: NO_TOOLS }),
      };
      return pictures(await http.post('/images/generations', body, { what, timeoutMs, signal }), n, what, signal);
    },
    async edit({ prompt, images, n, size, signal }) {
      const what = 'Editing a picture (muse-image-1.0)';
      if (images.length < 1 || images.length > MAX_INPUTS) throw new Error(`An edit takes 1 to ${MAX_INPUTS} pictures (given ${images.length})`);
      const body = {
        model,
        prompt,
        images: images.map((image) => ({ image_url: dataUrl(image) })),
        n: count(n),
        ...(size ? { size } : {}),
        response_format: 'b64_json',
        output_format: 'png',
        tool_enablement: NO_TOOLS,
      };
      return pictures(await http.post('/images/edits', body, { what, timeoutMs, signal }), n, what, signal);
    },
  };
}
