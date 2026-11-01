import { Color, Vector3, Vector4 } from 'three';
import { describe, expect, it } from 'vitest';
import { HEADS } from '../../life/flowers';
import { SPECIES_MESH } from '../../life/flowerMeshes';
import { createLookUniforms } from '../../render/look';
import { Palette } from '../../render/palette';
import { graded, paintFlower, toneCurve, worldLight, type HeroLook, type Rgb, type Shape } from './flowerPaint';

const look = createLookUniforms();
look.uToon.value.set(4, 0.08, 0.7, 0);
look.uSunTint.value = new Color(1, 1, 1);
look.uShadeTint.value = new Color(1, 1, 1);
const light = (sun = new Vector3(0, 1, 0), grade = { contrast: 1.1, brightness: 0.95 }) => worldLight(new Palette(), { ...look, uSunDir: { value: sun } }, grade);

function shape(species: number): Shape {
  const g = SPECIES_MESH[species]();
  return { part: g.getAttribute('aPart').array, t: g.getAttribute('aT').array, y: g.getAttribute('position').array.filter((_, i) => i % 3 === 1) };
}

const hero = (species: 0 | 1 | 2 | 3, more: Partial<HeroLook> = {}): HeroLook => ({
  species,
  variant: 0.5,
  dir: new Vector3(0, 1, 0),
  foot: new Vector3(0, 128, 0),
  camera: new Vector3(0, 131, 7),
  stemTop: HEADS[species][0],
  mark: 0,
  open: 0,
  lit: 0,
  ...more,
});

/** The mean colour of a flower's petals and of its stem. */
function means(species: 0 | 1 | 2 | 3, colours: Float32Array): { head: Rgb; stem: Rgb } {
  const { part } = shape(species);
  const sum = { head: [0, 0, 0, 0], stem: [0, 0, 0, 0] };
  for (let i = 0; i < part.length; i++) {
    if (part[i] > 1.5) continue;
    const s = part[i] > 0.5 ? sum.head : sum.stem;
    for (let c = 0; c < 3; c++) s[c] += colours[i * 3 + c];
    s[3]++;
  }
  const mean = (s: number[]): Rgb => [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
  return { head: mean(sum.head), stem: mean(sum.stem) };
}

const paint = (species: 0 | 1 | 2 | 3, more: Partial<HeroLook> = {}, l = light()) => means(species, paintFlower(shape(species), hero(species, more), l));
const brightness = (c: Rgb): number => c[0] + c[1] + c[2];

describe('a flower painted as its patch paints its hero', () => {
  it('gives every vertex a display colour inside 0..1', () => {
    for (const s of [0, 1, 2, 3] as const) {
      const c = paintFlower(shape(s), hero(s, { lit: 1, open: 1, mark: 1 }), light());
      expect(c.length).toBe(shape(s).part.length * 3);
      expect(Math.min(...c)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...c)).toBeLessThanOrEqual(1);
    }
  });

  it('paints each species in its own family over a green stem', () => {
    const pink = paint(0).head;
    const star = paint(1).head;
    const button = paint(2).head;
    const blue = paint(3).head;
    expect(pink[0]).toBeGreaterThan(pink[1] + 0.15);
    expect(Math.min(...star)).toBeGreaterThan(0.75);
    expect(Math.min(button[0], button[1])).toBeGreaterThan(button[2] + 0.25);
    expect(blue[2]).toBeGreaterThan(blue[0] + 0.1);
    for (const s of [0, 1, 2, 3] as const) {
      const stem = paint(s).stem;
      expect(stem[1]).toBeGreaterThan(Math.max(stem[0], stem[2]));
    }
  });

  it('is brighter with the sun overhead than with the sun behind the planet', () => {
    const lit = paint(0, {}, light(new Vector3(0, 1, 0))).head;
    const dark = paint(0, {}, light(new Vector3(0, -1, 0))).head;
    expect(brightness(lit)).toBeGreaterThan(brightness(dark) + 0.3);
  });

  it('turns more vivid when lit (never paler), and takes the basket’s cool tint when marked', () => {
    const plain = paint(3).head;
    const chroma = (c: Rgb): number => Math.max(...c) - Math.min(...c);
    for (const s of [0, 2, 3] as const) {
      const before = paint(s).head;
      const lit = paint(s, { lit: 1 }).head;
      expect(chroma(lit), `species ${s}`).toBeGreaterThan(chroma(before) + 0.05);
      // not washed out: no more white in it than before
      expect(Math.min(...lit), `species ${s}`).toBeLessThanOrEqual(Math.min(...before) + 0.02);
    }
    // the mark pulls the blue toward its pale lilac: redder, and no bluer
    const marked = paint(3, { mark: 1 }).head;
    expect(marked[0]).toBeGreaterThan(plain[0]);
  });

  it('pales with distance into the haze', () => {
    const near = paint(0).head;
    const far = paint(0, { camera: new Vector3(0, 300, 900) }, worldLight(new Palette(), { ...look, uFog: { value: new Vector4(0.01, 0.5, 0, 0.85) } }, { contrast: 1.1, brightness: 0.95 })).head;
    expect(Math.abs(far[0] - far[2])).toBeLessThan(Math.abs(near[0] - near[2]));
  });
});

describe('the frame’s grade', () => {
  it('is the display encoding of the tone curve at neutral contrast and brightness', () => {
    const [g] = graded([0.18, 0.18, 0.18], { contrast: 1, brightness: 1 });
    const t = toneCurve([0.18, 0.18, 0.18])[0];
    expect(g).toBeCloseTo(Math.pow(t, 0.41666) * 1.055 - 0.055, 5);
  });

  it('pivots contrast about mid grey and scales by brightness', () => {
    const neutral = graded([0.4, 0.4, 0.4], { contrast: 1, brightness: 1 })[0];
    const more = graded([0.4, 0.4, 0.4], { contrast: 1.2, brightness: 1 })[0];
    expect(more - 0.5).toBeCloseTo((neutral - 0.5) * 1.2, 5);
    expect(graded([0.4, 0.4, 0.4], { contrast: 1, brightness: 0.9 })[0]).toBeCloseTo(neutral * 0.9, 5);
  });
});
