import { describe, expect, it } from 'vitest';
import { ReactionError } from '../../garden/source';
import type { Invitation } from '../../garden/types';
import { readVisit } from '../../visit/params';
import { boardingUrl, closed, refusal, tripUrl } from './travel';

const SEARCH = '?garden=/api/muses/hero';
const ticket = (world: string): Invitation => ({ from: 'wren', fromName: 'Wren', coat: '#c4d0e6', world, worldName: 'Lantern Reed Gardens', blurb: '' });

describe('boarding on a ticket', () => {
  it('goes to the host’s planet, on this visit, as this garden’s Muse', () => {
    const url = boardingUrl('inv:wren:hero:1', ticket('lantern-reed-gardens'), SEARCH);
    expect(url?.startsWith('/environments/lantern-reed-gardens/?')).toBe(true);
    expect(readVisit(url!.slice(url!.indexOf('?')))).toEqual({ invitation: 'inv:wren:hero:1', as: 'hero', garden: '/api/muses/hero' });
    expect(boardingUrl('inv-1', ticket('meadow'), '?garden=http%3A%2F%2Flocalhost%3A8787%2Fapi%2Fmuses%2Fjuniper')).toBe(
      '/?visit=inv-1&as=juniper&garden=http%3A%2F%2Flocalhost%3A8787%2Fapi%2Fmuses%2Fjuniper',
    );
  });

  it('takes the dev tools along, and back to a trip under way', () => {
    const dev = `${SEARCH}&dev`;
    const url = boardingUrl('inv-1', ticket('lantern-reed-gardens'), dev);
    expect(readVisit(url!.slice(url!.indexOf('?')))).toEqual({ invitation: 'inv-1', as: 'hero', garden: '/api/muses/hero', dev: true });
    const back = tripUrl({ invitation: 'inv-1', host: 'wren', planet: 'golden-rye', until: 0 }, dev);
    expect(readVisit(back!.slice(back!.indexOf('?')))?.dev).toBe(true);
  });

  it('goes nowhere from the placeholder garden, or on a ticket that names no planet', () => {
    expect(boardingUrl('inv-pip', ticket('lantern-reed-gardens'), '')).toBeNull();
    expect(boardingUrl('inv-pip', ticket('mossy-hollow'), SEARCH)).toBeNull();
    expect(boardingUrl('inv-pip', ticket('lantern-reed-gardens'), '?garden=https://elsewhere.example/garden')).toBeNull();
  });

  it('finds the way back to a trip under way', () => {
    const url = tripUrl({ invitation: 'inv-1', host: 'wren', planet: 'golden-rye', until: 0 }, SEARCH);
    expect(readVisit(url!.slice(url!.indexOf('?')))).toEqual({ invitation: 'inv-1', as: 'hero', garden: '/api/muses/hero' });
    expect(url?.startsWith('/environments/golden-rye/?')).toBe(true);
    expect(tripUrl({ invitation: 'inv-1', host: 'wren', planet: 'nowhere', until: 0 }, SEARCH)).toBeNull();
  });

  it('keeps a ticket to a planet not open for visits in the post, and says so, before the backend is asked', () => {
    expect(closed(ticket('golden-rye'))).toBeNull();
    expect(closed(ticket('rice-terraces'))).toBe('Wren’s planet isn’t open for visits yet.');
    expect(boardingUrl('inv-1', ticket('rice-terraces'), SEARCH), 'and no visit page is ever made for it').toBeNull();
    expect(tripUrl({ invitation: 'inv-1', host: 'wren', planet: 'rice-terraces', until: 0 }, SEARCH)).toBeNull();
    expect(closed(ticket('mossy-hollow')), 'a placeholder’s world is no planet at all').toBeNull();
  });

  it('says why a ticket was turned down, or couldn’t be used', () => {
    expect(refusal(new ReactionError(409, 'this invitation is used'))).toMatch(/used already/);
    expect(refusal(new ReactionError(403, 'only the guest’s owner can use this invitation'))).toMatch(/someone else’s/);
    expect(refusal(new ReactionError(0, 'unreachable'))).toMatch(/Try again/);
    expect(refusal(new Error('anything'))).toMatch(/Try again/);
  });
});
