import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { COTTAGE_TO_POND, generateLayout, Terrain, type GroundSample } from '../../planet/terrain';
import { travel } from '../../planet/geo';

// Constant scale and attachment: things on the planet stay human-sized and
// seated at every size. (The cottage geometry itself is built in meters
// with no reference to R; see life/props.ts.)

const PARAMS = { meadowRoll: 1.4, mountainHeight: 0.18, channelWidth: 3.2 };
const layout = generateLayout(412, 3, 3);

function terrainAt(radius: number): Terrain {
  const t = new Terrain(layout);
  t.update(radius, Math.log(radius), PARAMS);
  return t;
}

/** Width (m) of the water run through `centre` along a great circle, sampled at 2 cm. */
function channelWidthAround(t: Terrain, centre: Vector3, across: Vector3): number {
  const step = 0.02 / t.radius;
  const p = new Vector3();
  const wet = (k: number): boolean => t.channelDistance(travel(centre, across, k * step, p)) < 0;
  if (!wet(0)) return 0;
  let lo = 0;
  let hi = 0;
  while (lo > -1000 && wet(lo - 1)) lo--;
  while (hi < 1000 && wet(hi + 1)) hi++;
  return (hi - lo + 1) * 0.02;
}

describe('constant scale', () => {
  it('keeps channel width in meters at the smallest and largest planet', () => {
    // a point on the trunk channel's finest centreline (a quarter of the way
    // along, clear of the branch that unlocks near its middle), and across it
    const line = layout.channels[0][2];
    const a = line[Math.floor(line.length / 4)];
    const b = line[Math.floor(line.length / 4) + 1];
    const along = new Vector3().subVectors(b, a).normalize();
    for (const radius of [40, 400]) {
      const t = terrainAt(radius);
      t.meander1 = t.meander2 = 1; // measure the fully meandered line at both sizes
      const across = new Vector3().crossVectors(a, along).normalize();
      // the midpoint of a fine segment sits on the centreline
      const centre = a.clone().add(b).normalize();
      const width = channelWidthAround(t, centre, across);
      expect(width, `R ${radius}`).toBeGreaterThan(PARAMS.channelWidth * 0.9);
      expect(width, `R ${radius}`).toBeLessThan(PARAMS.channelWidth * 1.25);
    }
  });

  it('keeps the homestead pond at the landing in meters, at every size', () => {
    const s: GroundSample = { height: 0, water: 0, mountain: 0, rock: 0, clearing: 0 };
    for (const radius of [40, 90, 128, 250, 400]) {
      const t = terrainAt(radius);
      // just past the landing's end is water, just inside the house front is dry land
      const pondSide = travel(layout.cottage, layout.homeBearing, (COTTAGE_TO_POND + 1.2) / radius, new Vector3());
      const houseSide = travel(layout.cottage, layout.homeBearing, 1.5 / radius, new Vector3());
      expect(t.sample(pondSide, s).water, `R ${radius} pond`).toBeLessThan(0);
      expect(t.sample(houseSide, s).water, `R ${radius} house`).toBeGreaterThan(0.5);
    }
  });
});

describe('everything stays attached', () => {
  it('seats the cottage on a flat clearing at every size', () => {
    const s: GroundSample = { height: 0, water: 0, mountain: 0, rock: 0, clearing: 0 };
    const across = new Vector3().crossVectors(layout.cottage, layout.homeBearing).normalize();
    for (const radius of [40, 128, 400]) {
      const t = terrainAt(radius);
      const heights: number[] = [];
      for (const [x, z] of [[-2.5, -2], [2.5, -2], [2.5, 2], [-2.5, 2], [0, 0]] as const) {
        const p = travel(layout.cottage, across, x / radius, new Vector3());
        travel(p, layout.homeBearing, z / radius, p);
        heights.push(t.sample(p, s).height);
        expect(s.clearing, `R ${radius} clearing at ${x},${z}`).toBeGreaterThan(0.5);
      }
      const spread = Math.max(...heights) - Math.min(...heights);
      expect(spread, `R ${radius}`).toBeLessThan(0.02);
      expect(Math.abs(heights[4] - t.cottageLevel)).toBeLessThan(0.005);
    }
  });

  it('keeps the cottage geometry the same size whatever the planet radius', async () => {
    const { Homestead } = await import('../../life/props');
    const a = new Box3().setFromObject(new Homestead({}, 412).group);
    const b = new Box3().setFromObject(new Homestead({}, 412).group);
    const size = a.getSize(new Vector3());
    expect(size.x).toBeGreaterThan(5);
    expect(size.y).toBeGreaterThan(4);
    expect(b.getSize(new Vector3()).distanceTo(size)).toBe(0);
  });
});
