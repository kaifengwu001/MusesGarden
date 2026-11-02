import type { Params } from '../params';
import type { GrowthState } from '../../../src/planet/growth';

/** Three significant figures with thousands separators: 205,808 → "206,000". */
export function formatArea(area: number): string {
  return Number(area.toPrecision(3)).toLocaleString('en-US');
}

/** Seeds read like catalogue numbers: 412 → "0412". */
export function seedLabel(seed: number): string {
  return String(seed).padStart(4, '0');
}

export function seasonFor(bloom: number): string {
  if (bloom < 0.2) return 'Quiet grove';
  if (bloom <= 0.85) return 'Forest light';
  return 'Sacred grove';
}

/** The place-style metadata line under the title. */
export function worldLine(p: Params, growth: GrowthState): string {
  return `${seasonFor(p.world.bloom)} · R ${Math.round(growth.radius)} m · ${formatArea(growth.area)} m² · seed ${seedLabel(p.world.seed)}`;
}
