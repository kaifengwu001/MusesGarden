import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { salt } from '../../core/hash';
import { areaOfRadius } from '../../planet/growth';
import { uvToSphere } from '../../planet/cubesphere';
import { enumerateCell, FADE_SECONDS, GrowthBand, type PointClass, type RestPoint } from '../../planet/rest';

const CLS: PointClass = { salt: salt('test'), jitter: 0.9 };
const SEED = 412;

interface Kept {
  id: string;
  rank: number;
  level: number;
  u: number;
  v: number;
  threshold: number;
}

function collect(face: number, L: number, I: number, J: number, sigmaMax: number, cls = CLS, seed = SEED): Kept[] {
  const out: Kept[] = [];
  enumerateCell(cls, seed, face, L, I, J, sigmaMax, (p: RestPoint) => {
    out.push({ id: `${p.face}/${p.level}/${p.i}/${p.j}`, rank: p.rank, level: p.level, u: p.u, v: p.v, threshold: p.threshold });
  });
  return out;
}

/** Every point on the planet visible at radius R for density ρ (per m²). */
function visibleAt(radius: number, density: number): Map<string, Kept> {
  const sigma = density * radius * radius;
  const map = new Map<string, Kept>();
  for (let f = 0; f < 6; f++) for (const p of collect(f, 0, 0, 0, sigma)) map.set(p.id, p);
  return map;
}

describe('progressive point sets', () => {
  it('holds exactly one point per cell at every complete level', () => {
    const all = collect(0, 0, 0, 0, 2000);
    for (let level = 0; level <= 4; level++) {
      const n = 2 ** level;
      const counts = new Int32Array(n * n);
      for (const p of all) if (p.rank < 4 ** level) counts[Math.floor(p.u * n) + n * Math.floor(p.v * n)]++;
      expect([...counts].every((c) => c === 1), `level ${level}`).toBe(true);
    }
  });

  it('gives each point a unique, gap-free birth rank', () => {
    const ranks = collect(3, 0, 0, 0, 2000)
      .map((p) => p.rank)
      .filter((r) => r < 1024)
      .sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: 1024 }, (_, k) => k));
  });

  it('builds the same points cell by cell as for the whole face', () => {
    const sigma = 900;
    const whole = collect(5, 0, 0, 0, sigma).map((p) => `${p.id}@${p.u},${p.v}`);
    const parts: string[] = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) parts.push(...collect(5, 2, i, j, sigma).map((p) => `${p.id}@${p.u},${p.v}`));
    expect(parts.sort()).toEqual(whole.sort());
  });

  it('is deterministic per seed and differs between seeds', () => {
    expect(collect(1, 1, 1, 0, 500)).toEqual(collect(1, 1, 1, 0, 500));
    expect(collect(1, 1, 1, 0, 500, CLS, 7)).not.toEqual(collect(1, 1, 1, 0, 500));
  });

  it('keeps every point in place as the planet grows and shrinks (no swimming)', () => {
    const density = 0.05; // per m²
    const rAt = (g: number): number => Math.sqrt((areaOfRadius(40) + (areaOfRadius(400) - areaOfRadius(40)) * g * g * (3 - 2 * g)) / (4 * Math.PI));
    const before = visibleAt(rAt(0.3), density);
    const grown = visibleAt(rAt(0.7), density);
    const after = visibleAt(rAt(0.3), density);
    expect(grown.size).toBeGreaterThan(before.size * 3);
    for (const [id, p] of before) {
      const q = grown.get(id);
      expect(q, id).toBeDefined();
      expect([q!.u, q!.v, q!.rank]).toEqual([p.u, p.v, p.rank]);
    }
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [id, p] of after) expect(p).toEqual(before.get(id));
  });

  it('keeps density per m² constant across the growth range (whole planet)', () => {
    const density = 0.08;
    for (let k = 0; k <= 8; k++) {
      const radius = 40 + k * 45;
      const n = visibleAt(radius, density).size;
      expect(n / areaOfRadius(radius) / density, `R ${radius}`).toBeGreaterThan(0.995);
      expect(n / areaOfRadius(radius) / density, `R ${radius}`).toBeLessThan(1.005);
    }
  });

  it('keeps density per m² within ±5% locally, at face centres, edges and corners', () => {
    const radius = 128;
    const density = 2;
    const capRadius = 22; // m: ~3000 expected points
    const sigma = density * radius * radius;
    const centre = new Vector3();
    const dir = new Vector3();
    const places: Array<[string, number, number, number]> = [
      ['centre', 2, 0.5, 0.5],
      ['edge', 4, 1, 0.5],
      ['corner', 0, 1, 1],
      ['off-axis', 3, 0.23, 0.71],
    ];
    for (const [name, face, u, v] of places) {
      uvToSphere(face, u, v, centre);
      const cosCap = Math.cos(capRadius / radius);
      let count = 0;
      for (let f = 0; f < 6; f++) {
        for (let i = 0; i < 8; i++) {
          for (let j = 0; j < 8; j++) {
            uvToSphere(f, (i + 0.5) / 8, (j + 0.5) / 8, dir);
            if (dir.dot(centre) < Math.cos(capRadius / radius + 0.25)) continue; // cell too far to matter
            enumerateCell(CLS, SEED, f, 3, i, j, sigma, (p) => {
              if (uvToSphere(p.face, p.u, p.v, dir).dot(centre) >= cosCap) count++;
            });
          }
        }
      }
      const area = 2 * Math.PI * radius * radius * (1 - cosCap);
      const ratio = count / area / density;
      expect(ratio, name).toBeGreaterThan(0.95);
      expect(ratio, name).toBeLessThan(1.05);
    }
  });
});

describe('growth fade band', () => {
  it('fades each new point in over 1.5 s during steady growth', () => {
    const band = new GrowthBand();
    const dt = 1 / 60;
    let r = 100;
    band.update(r, dt);
    const rate = 0.25; // ln R per second
    for (let t = 0; t < 6; t += dt) band.update((r *= Math.exp(rate * dt)), dt); // reach steady state
    const born = Math.log(r);
    let seconds = 0;
    while (band.fade(born) < 1 && seconds < 10) {
      band.update((r *= Math.exp(rate * dt)), dt);
      seconds += dt;
    }
    expect(seconds).toBeGreaterThan(FADE_SECONDS - 0.05);
    expect(seconds).toBeLessThan(FADE_SECONDS + 0.05);
  });

  it('runs backwards when shrinking and is a pure function of R at rest', () => {
    const band = new GrowthBand();
    band.update(200, 0.016);
    for (let k = 0; k < 120; k++) band.update(200 - k, 1 / 60); // shrinking: lag above R
    const between = Math.log(120); // inside the band: R = 81 m, R_lag ≈ 140 m
    expect(band.lnRLag).toBeGreaterThan(between);
    const fadeNew = band.fade(Math.log(81)); // died just now: still nearly full
    const fadeOld = band.fade(between); // died a while ago: further gone
    expect(fadeNew).toBeGreaterThan(fadeOld);
    band.settle(); // R = 81 m; the 1.5 % minimum band keeps the newest points partly grown
    expect(band.fade(Math.log(79))).toBe(1);
    expect(band.fade(Math.log(80.4))).toBeCloseTo(Math.log(81 / 80.4) / 0.015, 9);
    expect(band.fade(Math.log(81.2))).toBe(0);
  });
});
