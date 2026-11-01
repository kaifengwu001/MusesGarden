import type { Dir, NowView } from '../contract';

export type Route = NonNullable<NowView['path']>;

/**
 * Where Muse stands at sim time `t` on its route. Muse is at each point at its `at`, walks between
 * points along the great circle, and a point marked `transport` is reached by a jump at its `at`
 * (Muse waits at the previous point until then). Null for an empty route.
 */
export function dirAlong(route: Route, t: number): Dir | null {
  if (route.length === 0) return null;
  for (let i = 0; i < route.length; i++) {
    const b = route[i];
    if (t >= b.at) continue;
    if (i === 0) return b.dir;
    const a = route[i - 1];
    if (b.transport) return a.dir;
    return slerp(a.dir, b.dir, (t - a.at) / (b.at - a.at));
  }
  return route[route.length - 1].dir;
}

function slerp(a: Dir, b: Dir, s: number): Dir {
  const dot = Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const angle = Math.acos(dot);
  const [wa, wb] = angle < 1e-6 ? [1 - s, s] : [Math.sin((1 - s) * angle) / Math.sin(angle), Math.sin(s * angle) / Math.sin(angle)];
  const v = [wa * a[0] + wb * b[0], wa * a[1] + wb * b[1], wa * a[2] + wb * b[2]] as const;
  const n = Math.hypot(...v);
  return [v[0] / n, v[1] / n, v[2] / n];
}
