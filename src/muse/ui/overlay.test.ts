import { describe, expect, it } from 'vitest';
import { engineMuse } from './overlay';

describe('which Muse engine the page follows', () => {
  it("follows the Muse whose garden the engine serves, from the garden's address", () => {
    expect(engineMuse('?garden=/api/muses/fern')).toBe('fern');
    expect(engineMuse('?garden=/api/muses/fern/')).toBe('fern');
    expect(engineMuse('?garden=http://localhost:8787/api/muses/hero&dev')).toBe('hero');
    expect(engineMuse('?garden=/api/muses/a%20b')).toBe('a b');
  });

  it('follows the hero with ?dev alone, or with a garden served elsewhere', () => {
    expect(engineMuse('?dev')).toBe('hero');
    expect(engineMuse('?dev&garden=https://example.com/garden')).toBe('hero');
  });

  it("follows no engine on the garden's placeholders or a garden served elsewhere", () => {
    expect(engineMuse('')).toBeNull();
    expect(engineMuse('?garden=https://example.com/garden')).toBeNull();
    expect(engineMuse('?muse')).toBeNull();
  });
});
