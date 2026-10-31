import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkSchedule } from '../../src/muse/contract';
import { arr, obj, str } from '../adapters/sources/json';
import { FIXTURES_DIR } from './cast';

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** work-*.json: per Muse, sorted, non-overlapping busy intervals in ISO 8601 with an offset. */
export function parseWorkSchedule(raw: unknown): WorkSchedule {
  const o = obj(raw, 'work schedule');
  return Object.fromEntries(
    Object.entries(o).map(([id, list]) => {
      let lastEnd = -Infinity;
      const intervals = arr(list, id).map((iv, i) => {
        const at = `${id}[${i}]`;
        const block = obj(iv, at);
        const start = str(block.start, `${at}.start`);
        const end = str(block.end, `${at}.end`);
        if (!ISO_WITH_OFFSET.test(start) || !ISO_WITH_OFFSET.test(end)) throw new Error(`${at}: not ISO 8601 with an offset`);
        const [s, e] = [Date.parse(start), Date.parse(end)];
        if (!(s < e) || s < lastEnd) throw new Error(`${at}: empty, unsorted or overlapping`);
        lastEnd = e;
        return { start, end };
      });
      return [id, intervals];
    }),
  );
}

export function loadWork(name: 'work-3weeks' | 'work-none', dir = FIXTURES_DIR): WorkSchedule {
  return parseWorkSchedule(JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')));
}
