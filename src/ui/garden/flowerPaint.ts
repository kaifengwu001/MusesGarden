import { Color, type Vector3, type Vector4 } from 'three';
import { clamp, smoothstep } from '../../core/math';
import { ROW, type Palette } from '../../render/palette';

// The colours a find's flower in the basket is painted: its patch's hero as
// findBed.vert.glsl paints it (floraColour from meadow.glsl, toon.glsl's
// bands and three tones, the find's own light, the haze of fog.glsl), then the
// grade post.frag.glsl gives the whole frame (the tone curve, the display's
// encoding, contrast and brightness). The basket's canvas is not graded, so
// each flower carries the grade in its colours, and matches its hero where it
// lands. Left out: a cloud's or the cottage's shadow, the wind, the bloom.

export type Rgb = readonly [number, number, number];

/** What the paint reads from the world, as its shaders see it (all colours linear). */
export interface Light {
  /** A palette cell, as texelFetch reads it from the 8-bit sRGB texture. */
  readonly pal: (row: number, col: number) => Rgb;
  readonly sunDir: Vector3;
  readonly sunTint: Rgb;
  readonly shadeTint: Rgb;
  /** uToon: bands, band softness, rim strength. */
  readonly toon: Vector4;
  /** uFog: density per m, around strength, camera altitude (m), max; uFogUp. */
  readonly fog: Vector4;
  readonly fogUp: Vector3;
  /** The frame's grade (style.contrast, style.brightness). */
  readonly contrast: number;
  readonly brightness: number;
}

/** A hero as its patch shades it, and how it stands now. */
export interface HeroLook {
  readonly species: 0 | 1 | 2 | 3;
  readonly variant: number;
  /** Its direction from the planet's middle (its up), its stem's foot as drawn (warped), the camera. */
  readonly dir: Vector3;
  readonly foot: Vector3;
  readonly camera: Vector3;
  /** Its stem's top over its foot (m, before its size): flowers.ts HEADS. */
  readonly stemTop: number;
  /** findState: the basket's mark, its card's light, and the glow (max of lift, pulse and focus), 0..1. */
  readonly mark: number;
  readonly open: number;
  readonly lit: number;
}

/** The flower geometry's own attributes (flowerMeshes.ts): its part, its place along the stem, its height (m). */
export interface Shape {
  readonly part: ArrayLike<number>;
  readonly t: ArrayLike<number>;
  readonly y: ArrayLike<number>;
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scale = (a: Rgb, k: number): Rgb => [a[0] * k, a[1] * k, a[2] * k];
const mul = (a: Rgb, b: Rgb): Rgb => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const add = (a: Rgb, k: number): Rgb => [a[0] + k, a[1] + k, a[2] + k];
const plus = (a: Rgb, b: Rgb): Rgb => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** meadow.glsl floraColour: a flower's petal colour by species, colour variant (0..1) and light (0 shade … 1 sun). */
export function floraColour(pal: Light['pal'], s: number, v: number, lit: number): Rgb {
  let c: Rgb;
  let sh: Rgb;
  if (s === 0) {
    c = mix(pal(ROW.PINK, 6), pal(ROW.PINK, 0), smoothstep(0, 0.4, v));
    c = mix(c, pal(ROW.PINK, 7), smoothstep(0.55, 0.85, v));
    c = mix(c, pal(ROW.PINK, 8), smoothstep(0.9, 1, v));
    sh = mix(pal(ROW.PINK, 3), pal(ROW.PINK, 9), smoothstep(0.5, 0.9, v));
  } else if (s === 1) {
    c = mix(pal(ROW.STAR, 0), pal(ROW.STAR, 4), smoothstep(0.3, 0.75, v));
    c = mix(c, pal(ROW.STAR, 5), smoothstep(0.85, 1, v));
    sh = pal(ROW.STAR, 1);
  } else if (s === 2) {
    c = mix(pal(ROW.SCATTER, 10), pal(ROW.SCATTER, 0), smoothstep(0, 0.4, v));
    c = mix(c, pal(ROW.SCATTER, 6), smoothstep(0.82, 0.93, v));
    c = mix(c, pal(ROW.SCATTER, 4), smoothstep(0.94, 0.99, v));
    sh = mix(pal(ROW.SCATTER, 1), pal(ROW.SCATTER, 5), smoothstep(0.85, 0.99, v));
  } else {
    c = mix(pal(ROW.SCATTER, 2), pal(ROW.SCATTER, 8), smoothstep(0.35, 0.9, v));
    sh = mix(pal(ROW.SCATTER, 3), pal(ROW.SCATTER, 9), smoothstep(0.35, 0.9, v));
  }
  return mix(sh, c, lit);
}

/** toon.glsl toonLight: N·L as soft bands of light, 0..1. */
export function toonLight(ndl: number, toon: Vector4): number {
  const n = Math.max(toon.x, 2);
  const w = Math.max(toon.y, 1e-3);
  let acc = 0;
  for (let k = 1; k < 5; k++) {
    if (k > n - 1) break;
    const t = -0.04 + (0.4 + 0.04) * ((k - 1) / Math.max(n - 2, 1));
    acc += smoothstep(t - 0.5 * w, t + 0.5 * w, ndl);
  }
  return acc / (n - 1);
}

/** toon.glsl tone3: shade → mid → lit, in the sky's and the sun's light. */
function tone3(light: Light, lit: Rgb, mid: Rgb, shade: Rgb, b: number): Rgb {
  const half = mix(light.shadeTint, light.sunTint, 0.5);
  return b < 0.5 ? mix(mul(shade, light.shadeTint), mul(mid, half), b * 2) : mix(mul(mid, half), mul(lit, light.sunTint), b * 2 - 1);
}

/** post.frag.glsl toneCurve: a gentle S with a soft shoulder over 0.85, and a touch more saturation. */
export function toneCurve(c: Rgb): Rgb {
  const out = c.map((x) => {
    const over = Math.max(x - 0.85, 0);
    const y = x - over + over / (1 + over * 2.2);
    return y + (y * y * (3 - 2 * y) - y) * 0.18;
  }) as unknown as Rgb;
  const l = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  return out.map((x) => Math.max(l + (x - l) * 1.07, 0)) as unknown as Rgb;
}

/** three's sRGB output transfer (colorspace_fragment), as the frame is encoded for the display. */
function encode(x: number): number {
  return x <= 0.0031308 ? x * 12.92 : Math.pow(x, 0.41666) * 1.055 - 0.055;
}

/** A colour drawn in the meadow's light as the frame shows it: the tone curve, the display's encoding, then contrast and brightness (0..1). */
export function graded(c: Rgb, light: Pick<Light, 'contrast' | 'brightness'>): Rgb {
  return toneCurve(c).map((x) => clamp((encode(x) - 0.5) * light.contrast + 0.5, 0, 1) * light.brightness) as unknown as Rgb;
}

/** fog.glsl applyAerial: the haze between the camera and a point `distance` m away, at `dir` on the planet. */
function aerial(light: Light, c: Rgb, distance: number, dir: Vector3): Rgb {
  const f = light.fog;
  const beyond = Math.max(0, distance - f.z);
  const near = 1 - Math.exp(-beyond * f.x);
  const around = smoothstep(0.6, 1.62, Math.acos(clamp(dir.dot(light.fogUp), -1, 1))) * f.y;
  const sky = mix(light.pal(ROW.SKY, 1), light.pal(ROW.SKY, 2), 0.45);
  return mix(mix(c, light.pal(ROW.SKY, 5), Math.min(near, f.w)), sky, Math.min(around, f.w));
}

/**
 * Each vertex's colour (r, g, b; graded, display-ready) of a flower painted as its patch paints its hero:
 * findBed.vert.glsl's colour by species, variant and part, with no cloud or cottage shadow on it.
 */
export function paintFlower(shape: Shape, hero: HeroLook, light: Light): Float32Array {
  const { pal } = light;
  const s = hero.species;
  const v = hero.variant;
  const top = hero.stemTop;
  const lightBands = toonLight(hero.dir.dot(light.sunDir), light.toon);
  const toCam = hero.camera.clone().sub(hero.foot);
  const distance = toCam.length();
  const facing = clamp(-toCam.normalize().dot(light.sunDir) * 0.7 + 0.3, 0, 1);
  const flora = (lit: number): Rgb => floraColour(pal, s, v, lit);
  const markTint = pal(ROW.STAR, 5);
  const glow = mix(pal(ROW.LIGHT, 0), pal(ROW.SCATTER, 10), 0.35);
  const n = shape.part.length;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const part = shape.part[i];
    const t = shape.t[i];
    const b = lightBands * (0.55 + 0.45 * t);
    let col: Rgb;
    if (part < 0.5) {
      col = tone3(light, pal(ROW.PINK, 4), mix(pal(ROW.PINK, 4), pal(ROW.PINK, 5), 0.5), pal(ROW.PINK, 5), b * 0.85);
    } else if (s === 0) {
      const y = shape.y[i];
      const inner = smoothstep(top + 0.05, top, y);
      const lip = smoothstep(top + 0.065, top + 0.103, y);
      const petal = tone3(light, flora(1), flora(0.55), flora(0), b * (0.75 + 0.25 * lip));
      col = mix(petal, tone3(light, pal(ROW.PINK, 2), pal(ROW.PINK, 2), flora(0.4), b), inner * 0.6);
    } else if (s === 1) {
      col = part > 1.5 ? tone3(light, pal(ROW.STAR, 3), pal(ROW.STAR, 2), pal(ROW.SCATTER, 1), b) : tone3(light, flora(1), flora(0.6), flora(0), b);
    } else if (s === 2) {
      col = tone3(light, flora(1), flora(0.6), flora(0), b);
      if (part > 1.5) col = scale(col, 0.85);
    } else {
      col = part > 1.5 ? pal(ROW.STAR, 0) : tone3(light, flora(1), flora(0.5), flora(0), b);
    }
    col = plus(col, scale(pal(ROW.LIGHT, 3), t * facing * 0.12 * light.toon.z));
    const head = part > 0.5 ? 1 : 0;
    col = mix(col, plus(scale(col, 0.85), scale(markTint, 0.22)), hero.mark * (0.3 + 0.2 * head));
    col = mix(col, add(scale(col, 1.12), 0.025), hero.open * head);
    const l = 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2];
    const vivid = col.map((x, c) => Math.max((l + (x - l) * 2.0) * 1.06, 0) + glow[c] * 0.03) as unknown as Rgb;
    col = mix(col, vivid, hero.lit * (0.45 + 0.55 * head));
    const c = graded(aerial(light, col, distance, hero.dir), light);
    out.set(c, i * 3);
  }
  return out;
}

/** The world's light as the paint reads it: the palette through its 8-bit texture, the look's uniforms, the grade. */
export function worldLight(
  palette: Palette,
  look: { uSunDir: { value: Vector3 }; uSunTint: { value: Color }; uShadeTint: { value: Color }; uToon: { value: Vector4 }; uFog: { value: Vector4 }; uFogUp: { value: Vector3 } },
  grade: { contrast: number; brightness: number },
): Light {
  const c = new Color();
  const cells = new Map<number, Rgb>();
  const rgb = (x: Color): Rgb => [x.r, x.g, x.b];
  return {
    pal: (row, col) => {
      const key = row * 16 + col;
      let cell = cells.get(key);
      if (!cell) {
        // as the shaders read it: stored as 8-bit sRGB, decoded on fetch
        palette.get(row, col, c).convertLinearToSRGB();
        c.setRGB(Math.round(clamp(c.r, 0, 1) * 255) / 255, Math.round(clamp(c.g, 0, 1) * 255) / 255, Math.round(clamp(c.b, 0, 1) * 255) / 255).convertSRGBToLinear();
        cell = rgb(c);
        cells.set(key, cell);
      }
      return cell;
    },
    sunDir: look.uSunDir.value,
    sunTint: rgb(look.uSunTint.value),
    shadeTint: rgb(look.uShadeTint.value),
    toon: look.uToon.value,
    fog: look.uFog.value,
    fogUp: look.uFogUp.value,
    contrast: grade.contrast,
    brightness: grade.brightness,
  };
}
