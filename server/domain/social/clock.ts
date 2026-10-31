import type { Instant } from '../../../src/muse/contract';

const formats = new Map<string, Intl.DateTimeFormat>();

function formatFor(timeZone: string): Intl.DateTimeFormat {
  let format = formats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
    formats.set(timeZone, format);
  }
  return format;
}

export function localClock(at: Instant, timeZone: string): { readonly day: string; readonly minute: number } {
  const part: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const p of formatFor(timeZone).formatToParts(at)) part[p.type] = p.value;
  return {
    day: `${part.year}-${part.month}-${part.day}`,
    minute: Number(part.hour) * 60 + Number(part.minute),
  };
}
