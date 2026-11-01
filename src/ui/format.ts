import type { Params } from '../params';
import type { GrowthState } from '../planet/growth';

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

/** The place-style metadata line under the title. */
export function worldLine(p: Params, growth: GrowthState): string {
  return `${seasonFor(p.world.bloom)} · R ${Math.round(growth.radius)} m · ${formatArea(growth.area)} m² · seed ${seedLabel(p.world.seed)}`;
}

/** The terraces' season, by the same slider (Bloom): the paddies flooded at 0, the rice on its way, grown by 1. */
export function riceSeasonFor(bloom: number): string {
  if (bloom < 0.1) return 'Flooding';
  if (bloom < 0.45) return 'Planting';
  if (bloom <= 0.85) return 'Growing';
  return 'Midsummer';
}

/** The metadata line on the terraces. */
export function terracesLine(p: Params, growth: GrowthState): string {
  return `The terraces · ${riceSeasonFor(p.world.bloom)} · R ${Math.round(growth.radius)} m · ${formatArea(growth.area)} m² · seed ${seedLabel(p.world.seed)}`;
}
