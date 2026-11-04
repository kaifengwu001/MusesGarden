// journal.md: Muse's days in its own words, one line per thing that happened, on the owner's clock.
import type { MuseEvent, MuseState, StoredEvent } from '../../src/muse/contract';
import { SLEEP_MIN_MS } from './policy/constants';
import { localClock, localDay } from './time';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function heading(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `## ${d} ${MONTHS[m - 1]}`;
}

function sentence(e: MuseEvent): string | null {
  switch (e.kind) {
    case 'episode.started': {
      const p = e.plan;
      switch (p.activity) {
        case 'rest':
          return p.until - e.at >= SLEEP_MIN_MS ? 'Went to sleep.' : 'Lay down in the grass for a while.';
        case 'beyond':
          return 'Went beyond the planet.';
        case 'visit':
          return p.role === 'host' ? 'A friend came over.' : "Went to a friend's planet.";
        case 'travel':
          switch (p.trip.kind) {
            case 'revisit':
              return `Went back to ${p.trip.topic}.`;
            case 'new-area':
              return `Set off somewhere new, after ${p.trip.topic}.`;
            case 'serendipity':
              return 'Wandered off somewhere far.';
          }
      }
      break;
    }
    case 'region.revealed':
      return `The fog lifted over a new area: ${e.topic}.`;
    case 'discovery.collected':
      return e.discovery.provenance === 'own' ? `Kept *${e.discovery.title}*.` : null;
    case 'hangout':
      return e.received ? `Spent time with a friend and came away with *${e.received.title}*.` : 'Spent time with a friend.';
    case 'encounter':
      return e.where === 'online' ? 'Got talking online with the Muse of someone you know.' : 'Met another Muse out beyond the planet.';
    case 'relationship.changed':
      return e.to === 'friends' ? 'Made a new friend.' : e.to === 'ended' ? 'A friendship ended.' : null;
    case 'photo.taken':
      return `Took a photo (${e.photo.subject}).`;
    case 'basket.delivered':
      return `Sent you a basket of ${e.basket.items.length} ${e.basket.items.length === 1 ? 'find' : 'finds'}.`;
    case 'question.opened':
      return `Wondered: ${e.question.text}`;
    case 'reflection.committed':
      return e.narrative ? `Thought things over. ${e.narrative}` : 'Thought things over.';
    case 'host.work':
      return e.state === 'started' ? 'Laptop out for work.' : 'Work done.';
    case 'trip.reported':
      return `Went browsing: ${e.thread.replace(/[.!?…]+$/, '')}.`;
    case 'muse.checkedOut':
      return `Checked out, ${e.mood.replace(/[.!?…]+$/, '')}.${e.plan ? ` ${e.plan}` : ''}`;
    default:
      return null;
  }
  return null;
}

/** The whole journal, or one owner-local day of it (YYYY-MM-DD). */
export function renderJournal(s: MuseState, log: readonly StoredEvent[], day: string | null): string {
  const tz = s.seed.timezone;
  const days = new Map<string, string[]>();
  for (const { museId, event } of log) {
    if (museId !== s.seed.id) continue;
    const d = localDay(event.at, tz);
    const line = day === null || d === day ? sentence(event) : null;
    if (line) days.set(d, [...(days.get(d) ?? []), `- ${localClock(event.at, tz)} ${line}`]);
  }
  return [...days].map(([d, lines]) => `${heading(d)}\n\n${lines.join('\n')}\n`).join('\n');
}
