import { describe, expect, it } from 'vitest';
import { DRESSED } from '../../life/museMesh';
import { faceOf } from './faces';

describe('a Muse’s face', () => {
  it('is its own for every body a Muse can wear', () => {
    const looks = Object.keys(DRESSED);
    expect(looks.length).toBeGreaterThan(0);
    const faces = looks.map((look) => faceOf(look));
    for (const [k, face] of faces.entries()) expect(face, `${looks[k]} has a face`).toBeTruthy();
    expect(new Set(faces).size, 'each body its own face').toBe(looks.length);
    expect(faceOf('tpose6')).toBeTruthy();
    expect(faces).not.toContain(faceOf('tpose6'));
  });

  it('is none for a body it doesn’t know, or none given: the stand-in is shown', () => {
    expect(faceOf(undefined)).toBeNull();
    expect(faceOf('muse99')).toBeNull();
  });
});
