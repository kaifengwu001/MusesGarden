import { describe, expect, it } from 'vitest';
import { generatedUrl, isGeneratedLook, isLook, knownLook } from '../muse/looks';
import { FIELD_FIT } from './museBody';
import { fitOf } from './museDress';
import { DRESSED, GENERATED, generatedSculpt } from './museMesh';

// A body the workshop made (gen-<muse>-<n>), wherever a muse in clothes is drawn: how it is rigged (museMesh.ts
// GENERATED, with its own knobs) and where its files are.

describe('a made body’s rig (museMesh.ts GENERATED)', () => {
  it('starts as every new muse in clothes does (muse-rig): DRESSED_CUT(0.45), ramp 0.07, refine 2 and 2, no corrective, fur [9, 16], tpose6’s fit', () => {
    // (muse3 is a muse in clothes still on the starting entry)
    expect(GENERATED).toEqual(DRESSED.muse3);
  });

  it('is GENERATED itself without knobs of its own', () => {
    for (const none of [undefined, null, {}]) {
      const { sculpt, ignored } = generatedSculpt(none);
      expect(sculpt).toEqual(GENERATED);
      expect(ignored).toEqual([]);
    }
  });

  it('takes its own knobs by Sculpt’s and Dress’s names, the rest as GENERATED has them', () => {
    const { sculpt, ignored } = generatedSculpt({ cut: { arm: { x: 0.4 }, body: { z: [-0.3, 0.3] } }, ramp: 0.12, dress: { hem: 0.6, sleeve: 0.335, whole: 0.6 } });
    expect(ignored).toEqual([]);
    expect(sculpt.cut).toEqual({ arm: { x: 0.4, y: [0, 1] }, body: { x: 0.2, y: [0.3, 0.68], z: [-0.3, 0.3] } });
    expect(sculpt.ramp).toBe(0.12);
    expect(sculpt.refine).toEqual({ body: 2, face: 2 });
    expect(sculpt.dress).toEqual({ fur: [9, 16], hem: 0.6, sleeve: 0.335, whole: 0.6 });
    expect(sculpt.fit).toBe(GENERATED.fit);
    // (GENERATED itself is left as it was)
    expect(GENERATED.cut.arm.x).toBe(0.45);
    expect(GENERATED.dress).toEqual({ fur: [9, 16] });
  });

  it('rigs as muse6 with muse6’s knobs', () => {
    const muse6 = DRESSED.muse6;
    expect(generatedSculpt({ cut: muse6.cut, ramp: muse6.ramp, refine: muse6.refine, dress: muse6.dress }).sculpt).toEqual(muse6);
  });

  it('passes over a knob it doesn’t know, of the wrong kind or out of its range, naming each', () => {
    const { sculpt, ignored } = generatedSculpt({
      fit: { rest: [] },
      corrective: true,
      mirrorArm: true,
      colour: 'red',
      cut: { arm: { x: 5, y: [0.6, 0.3] }, body: 'wide' },
      ramp: '0.1',
      refine: { body: 2.5, face: 9 },
      dress: { fur: [16, 9], hangOut: Number.NaN, sleeves: 0.25, cape: true },
    });
    expect(ignored.sort()).toEqual(['colour', 'corrective', 'cut.arm.x', 'cut.arm.y', 'cut.body', 'dress.cape', 'dress.fur', 'dress.hangOut', 'fit', 'mirrorArm', 'ramp', 'refine.body', 'refine.face'].sort());
    expect(sculpt).toEqual({ ...GENERATED, dress: { fur: [9, 16], sleeves: 0.25 } });
    expect(generatedSculpt([1, 2]).ignored).toEqual(['(not an object)']);
    expect(generatedSculpt('cut').sculpt).toEqual(GENERATED);
  });

  it('measures its skeleton off it, tpose6’s until it is', () => {
    const measured = { ...FIELD_FIT, reach: 1.23 };
    expect(fitOf('gen-pooh-1', { fit: measured })).toBe(measured);
    expect(fitOf('gen-pooh-1', {})).toBe(GENERATED.fit);
  });
});

describe('a made body’s look (src/muse/looks.ts)', () => {
  it('is gen-<muse>-<n>, lower case, letters, digits and dashes', () => {
    for (const ok of ['gen-pooh-1', 'gen-test-1', 'gen-a', 'gen-0-0']) expect(isGeneratedLook(ok), ok).toBe(true);
    for (const no of ['gen-', 'gen--1', 'gen-Pooh-1', 'GEN-pooh-1', 'gen-../x', 'gen-pooh/1', 'gen-pooh.1', 'gen-pooh 1', 'tpose6', 'muse5']) expect(isGeneratedLook(no), no).toBe(false);
    expect(isLook('gen-pooh-1')).toBe(true);
    expect(isLook('muse12')).toBe(true);
    expect(isLook('muse13')).toBe(false);
    expect(isLook(7)).toBe(false);
  });

  it('is served by the engine: its model and its knobs', () => {
    expect(generatedUrl('gen-pooh-1', 'glb')).toBe('/api/looks/gen-pooh-1.glb');
    expect(generatedUrl('gen-pooh-1', 'json')).toBe('/api/looks/gen-pooh-1.json');
  });

  it('is the original Muse on a world that can’t draw it', () => {
    expect(knownLook('gen-pooh-1')).toBe('tpose6');
    expect(knownLook('muse5')).toBe('muse5');
    expect(knownLook('tpose6')).toBe('tpose6');
  });
});
