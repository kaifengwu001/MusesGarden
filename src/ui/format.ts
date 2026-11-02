import type { Params } from '../params';
import type { GrowthState } from '../planet/growth';
import { unfoldBloom } from '../planet/unfold';

/** Three significant figures with thousands separators: 205,808 → "206,000". */
export function formatArea(area: number): string {
  return Number(area.toPrecision(3)).toLocaleString('en-US');
}

/** Seeds read like catalogue numbers: 412 → "0412". */
export function seedLabel(seed: number): string {
  return String(seed).padStart(4, '0');
}

export function seasonFor(bloom: number): string {
  if (bloom < 0.2) return 'Early spring';
  if (bloom <= 0.85) return 'Spring';
  return 'Late spring';
}

/** The season the meadow shows: its bloom, as far as the unfolding has brought the flowers out (planet/unfold.ts). */
export function seasonOf(p: Params): string {
  return seasonFor(Math.min(p.world.bloom, unfoldBloom(p.world.unfold)));
}

/** The place-style metadata line under the title. */
export function worldLine(p: Params, growth: GrowthState): string {
  return `${seasonOf(p)} · R ${Math.round(growth.radius)} m · ${formatArea(growth.area)} m² · seed ${seedLabel(p.world.seed)}`;
}
