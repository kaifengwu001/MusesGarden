import { describe, expect, it } from 'vitest';
import type { NowView } from '../contract';
import { sampleNowAway, sampleNowBeyond, sampleNowExploring, sampleNowHosting, sampleNowNapping, sampleNowWorking } from '../samples';
import { intent } from './body';

const at = (v: NowView) => v.at;

describe("what the 3D Muse does for each of the engine's activities", () => {
  it('walks its route on the planet while exploring', () => {
    expect(intent(sampleNowExploring, at(sampleNowExploring))).toMatchObject({ kind: 'out', busy: false });
  });

  it('puts the laptop out where it is while working', () => {
    expect(intent(sampleNowWorking, at(sampleNowWorking))).toMatchObject({ kind: 'out', busy: true });
  });

  it('keeps to the terrace while resting or hosting', () => {
    expect(intent(sampleNowNapping, at(sampleNowNapping))).toEqual({ kind: 'home', busy: false });
    expect(intent(sampleNowHosting, at(sampleNowHosting))).toEqual({ kind: 'home', busy: false });
  });

  it('is not drawn while beyond the planet or away at a friend’s', () => {
    expect(intent(sampleNowBeyond, at(sampleNowBeyond))).toEqual({ kind: 'hidden' });
    expect(intent(sampleNowAway, at(sampleNowAway))).toEqual({ kind: 'hidden' });
  });

  it('leaves Muse as it is before the engine has answered', () => {
    expect(intent(null, 0)).toBeNull();
  });
});
