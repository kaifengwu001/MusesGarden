import { describe, expect, it } from 'vitest';
import { apiUrl, homeUrl, leftPhrase, readVisit, visitUrl } from './params';

describe('a visit’s URL', () => {
  it('names the ticket and the guest, and keeps the garden it came from', () => {
    expect(readVisit('?visit=inv-wren-hero-1&as=hero&garden=/api/muses/hero')).toEqual({ invitation: 'inv-wren-hero-1', as: 'hero', garden: '/api/muses/hero' });
    expect(readVisit('?visit=inv%3Awren%3Ahero%3A1&as=hero&garden=http%3A%2F%2Flocalhost%3A8787%2Fapi%2Fmuses%2Fhero')).toEqual({
      invitation: 'inv:wren:hero:1',
      as: 'hero',
      garden: 'http://localhost:8787/api/muses/hero',
    });
  });

  it('is no visit without a ticket or a guest, and finds the guest’s own garden when none is named', () => {
    expect(readVisit('')).toBeNull();
    expect(readVisit('?garden=/api/muses/hero')).toBeNull();
    expect(readVisit('?visit=inv-1')).toBeNull();
    expect(readVisit('?visit=inv-1&as=')).toBeNull();
    expect(readVisit('?visit=inv-1&as=wren')?.garden).toBe('/api/muses/wren');
  });

  it('round-trips through the host planet’s page, and goes home to the guest’s own', () => {
    const p = { invitation: 'inv:wren:hero:1', as: 'hero', garden: '/api/muses/hero' };
    const url = visitUrl('lantern-reed-gardens', p);
    expect(url.startsWith('/environments/lantern-reed-gardens/?')).toBe(true);
    expect(readVisit(url.slice(url.indexOf('?')))).toEqual(p);
    expect(homeUrl('meadow', p)).toBe('/?garden=%2Fapi%2Fmuses%2Fhero');
    expect(new URLSearchParams(homeUrl('golden-rye', p).split('?')[1]).get('garden')).toBe('/api/muses/hero');
    expect(homeUrl('golden-rye', p).startsWith('/environments/golden-rye/?')).toBe(true);
  });

  it('asks the API on the garden’s own host', () => {
    const page = 'http://localhost:5173/environments/lantern-reed-gardens/?visit=x&as=hero';
    expect(apiUrl('/api/muses/hero', '/api/visits/x/world?as=hero', page)).toBe('http://localhost:5173/api/visits/x/world?as=hero');
    expect(apiUrl('http://localhost:8787/api/muses/hero', '/api/visits/x/return?as=hero', page)).toBe('http://localhost:8787/api/visits/x/return?as=hero');
  });
});

describe('the time left, as the banner says it', () => {
  it.each<[number, string]>([
    [102 * 60_000, '1 h 42 left'],
    [101.2 * 60_000, '1 h 42 left'],
    [2 * 3_600_000, '2 h left'],
    [65 * 60_000, '1 h 05 left'],
    [42 * 60_000, '42 min left'],
    [50_000, 'a minute left'],
    [0, 'time to go home'],
    [-5_000, 'time to go home'],
  ])('%i ms: %s', (ms, phrase) => {
    expect(leftPhrase(ms)).toBe(phrase);
  });
});
