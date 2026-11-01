import type { Params } from '../params';

/** Three significant figures with thousands separators: 205,808 → "206,000". */
export function formatArea(area: number): string {
  return Number(area.toPrecision(3)).toLocaleString('en-US');
}

/** Seeds read like catalogue numbers: 412 → "0412". */
export function seedLabel(seed: number): string {
  return String(seed).padStart(4, '0');
}

export function seasonFor(season: Params['weather']['season']): string {
  return season === 'snow' ? 'Snowfall' : 'Rain';
}

/** The place-style metadata line under the title. */
export function worldLine(p: Params): string {
  return `${seasonFor(p.weather.season)} · A quiet home among the pines`;
}
