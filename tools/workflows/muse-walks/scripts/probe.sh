#!/usr/bin/env bash
# Muse's life on the planet sampled in Node: vitest runs museRoam.ts itself, so no browser or server.
#   probe.sh <out-prefix> [minutes=80] [step=0.1] [commit|checkout]
# A commit (e.g. 0924020) is checked out in a temporary worktree (node_modules shared), for a before/after.
# Writes, in the homestead's frame (meters; x across the house's front, z toward the pond, where the
# porch and pier are; heading in radians, 0 = +z, π/2 = +x):
#   <out-prefix>.txt        per sample: t x z walk heading water   (walk 0–1; water < 0 is in a pond)
#   <out-prefix>.names.txt  per part of its day: start (s) and name
#   <out-prefix>.geo.json   the homestead's shapes and the water nearby, for plot.py and scan.py
# Use step 1/60 (0.016667) to judge turns frame by frame, 0.1 for pictures of where it goes.
# env: SEED (planet, default 412), R (radius m, default 128), H (Muse's height m, default 1.65).
set -euo pipefail
out="${1:?usage: probe.sh <out-prefix> [minutes] [step] [commit|checkout]}"
minutes="${2:-80}"
step="${3:-0.1}"
where="${4:-}"
case "$out" in /*) ;; *) out="$PWD/$out" ;; esac
root="$(git rev-parse --show-toplevel)"
dir="$root"
tmp=""
test_file=""
cleanup() {
  [ -n "$test_file" ] && rm -f "$test_file"
  if [ -n "$tmp" ]; then
    git -C "$root" worktree remove --force "$tmp/wt" >/dev/null 2>&1 || true
    rm -rf "$tmp"
  fi
}
trap cleanup EXIT
if [ -n "$where" ]; then
  if [ -d "$where" ]; then
    dir="$(cd "$where" && pwd)"
  else
    tmp="$(mktemp -d)"
    git -C "$root" worktree add --detach "$tmp/wt" "$where" >/dev/null
    ln -s "$root/node_modules" "$tmp/wt/node_modules"
    dir="$tmp/wt"
  fi
fi
# (vitest only runs files in the suite's folders: this one is written there for the run and removed after)
test_file="$dir/src/dev/invariants/zz-walks-probe.test.ts"
cat >"$test_file" <<TS
// Written and removed by the muse-walks skill's probe.sh: not part of the suite.
import { writeFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { it } from 'vitest';
import * as terrains from '../../planet/terrain';
import * as props from '../../life/props';
import * as roams from '../../life/museRoam';

// (as museRoam.test.ts sets the planet up)
const PARAMS = { roll: 1.25, hummocks: 0.35, wetlands: 0.42, waterLevel: 0, grain: 0.6, density: 10, patchiness: 0.78, patchSize: 13, weights: [0.4, 0.24, 0.22, 0.14] };
const SEED = ${SEED:-412}, R = ${R:-128}, H = ${H:-1.65}, MINUTES = ${minutes}, STEP = ${step};
const OUT = '${out}';

it('samples Muse on the planet', () => {
  const terrain = new terrains.Terrain(terrains.generateLayout(SEED));
  terrain.update(R, PARAMS as never, (2 * R) / 512);
  const roam = new roams.MuseRoam(terrain, H);
  const camera = terrain.layout.cottage.clone().multiplyScalar(R + 30);
  const ground = terrains.createGroundSample();
  const c = { x: 0, z: 0 };
  const d = { x: 0, z: 0 };
  const ahead = new Vector3();
  const rows: string[] = [];
  const n = Math.round((MINUTES * 60) / STEP);
  for (let i = 0; i < n; i++) {
    const t = i * STEP;
    const m = roam.at(t, camera);
    terrain.cottageLocal(m.dir, c);
    terrain.cottageLocal(ahead.copy(m.dir).addScaledVector(m.heading, 1e-5).normalize(), d);
    const heading = Math.atan2(d.x - c.x, d.z - c.z);
    rows.push(\`\${t.toFixed(4)} \${c.x.toFixed(3)} \${c.z.toFixed(3)} \${m.action.walk.toFixed(2)} \${heading.toFixed(4)} \${terrain.sample(m.dir, ground).water.toFixed(2)}\`);
  }
  writeFileSync(\`\${OUT}.txt\`, rows.join('\n') + '\n');
  writeFileSync(\`\${OUT}.names.txt\`, roam.names.map((p) => \`\${p.start.toFixed(3)} \${p.name}\`).join('\n') + '\n');
  // the homestead and the water about it (a 0.5 m grid, 40 m round), where Muse's own map puts them
  const local = (roam as unknown as { local(x: number, z: number): Vector3 }).local.bind(roam);
  const water: number[][] = [];
  for (let x = -40; x <= 40; x += 0.5) for (let z = -40; z <= 40; z += 0.5) if (terrain.sample(local(x, z), ground).water < 0) water.push([x, z]);
  const P = props as unknown as Record<string, Record<string, number> | undefined>;
  const K = (roams as unknown as Record<string, Record<string, number> | undefined>).STOVE;
  const rect = (x0: number, x1: number, z0: number, z1: number) => ({ x0, x1, z0, z1 });
  const C = P.COTTAGE!, T = P.TERRACE!, Q = P.PIER!, S = P.STEPS!, B = P.BENCH, CH = P.CHAIR;
  const geo = {
    seed: SEED, R, H, minutes: MINUTES, step: STEP,
    walls: rect(-(C.halfX + C.thickness / 2), C.halfX + C.thickness / 2, -(C.halfZ + C.thickness / 2), C.halfZ + C.thickness / 2),
    terrace: rect(T.x0, T.x1, T.z0, T.z1),
    pier: rect(Q.x0, Q.x1, Q.z0, Q.z1),
    steps: rect(S.x0, S.x1, T.z1, T.z1 + S.count * S.tread),
    bench: B ? rect(B.x - B.half, B.x + B.half, B.z - B.depth, B.z + B.depth) : null,
    stove: K ? rect(K.x - K.half, K.x + K.half, K.z - K.half, K.z + K.half) : null,
    chair: CH ? { x: CH.x, z: CH.z, r: 0.3 } : null,
    water,
  };
  writeFileSync(\`\${OUT}.geo.json\`, JSON.stringify(geo));
}, 600000);
TS
(cd "$dir" && npx vitest run src/dev/invariants/zz-walks-probe.test.ts 2>&1 | grep -E "Tests |Error|FAIL" | head -8)
echo "$(wc -l <"$out.txt" | tr -d ' ') samples, $(wc -l <"$out.names.txt" | tr -d ' ') parts → $out.{txt,names.txt,geo.json} ($([ -n "$where" ] && echo "at $where" || echo "this checkout"))"
