import { describe, expect, it } from 'vitest';
import { path, ROUTES } from './routes';

describe('the shared route table', () => {
  it('fills params with encoding and appends only the query values that are set', () => {
    expect(path('plant', { id: 'hero', pid: 'd:hero:1:0:0' })).toBe('/api/muses/hero/plants/d%3Ahero%3A1%3A0%3A0');
    expect(path('baskets', { id: 'hero' }, { before: null, limit: 20 })).toBe('/api/muses/hero/baskets?limit=20');
    expect(path('withdraw', { id: 'inv 1' }, { as: 'wren' })).toBe('/api/invitations/inv%201/withdraw?as=wren');
    expect(path('clock', {})).toBe('/api/dev/clock');
  });

  it('has one pattern per method and path', () => {
    const keys = Object.values(ROUTES).map((r) => `${r.method} ${r.pattern}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of Object.values(ROUTES)) expect(r.pattern.startsWith('/api/')).toBe(true);
  });
});
