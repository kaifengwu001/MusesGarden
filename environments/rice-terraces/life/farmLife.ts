import {
  BufferGeometry, Color, CylinderGeometry, DoubleSide, Float32BufferAttribute,
  Group, IcosahedronGeometry, InstancedMesh, Matrix4, MeshStandardMaterial,
  Quaternion, Vector3,
} from 'three';
import { hash32, unit } from '../../../src/core/hash';
import { RICE_RADIUS, sampleRiceField } from '../planet/riceFields';
import type { CottageSite } from '../planet/cottageSite';
import { sampleCottageGround } from '../planet/cottageGround';

const UP = new Vector3(0, 1, 0);
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const TREE_LIMIT = 420;
const RICE_LIMIT = 2600;

export interface FarmTreeSite {
  direction: Vector3;
  height: number;
  trunkHeight: number;
  crownSize: number;
  turn: number;
  variation: number;
  region: number;
}
export interface RiceTuftSite {
  direction: Vector3;
  height: number;
  scale: number;
  turn: number;
  variation: number;
  plot: number;
}
export interface FarmLifeLayout { trees: FarmTreeSite[]; riceTufts: RiceTuftSite[]; }

function randomStream(seed: number): () => number {
  let state = hash32(seed);
  return () => unit(state = hash32((state + 0x9e3779b9) >>> 0));
}

function directionAt(i: number, count: number, phase: number): Vector3 {
  const y = 1 - 2 * (i + 0.5) / count;
  const radius = Math.sqrt(1 - y * y), angle = i * GOLDEN_ANGLE + phase;
  return new Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
}

function tangentFrame(direction: Vector3): readonly [Vector3, Vector3] {
  const x = new Vector3().crossVectors(direction, Math.abs(direction.y) < 0.9 ? UP : new Vector3(1, 0, 0)).normalize();
  return [x, new Vector3().crossVectors(x, direction).normalize()];
}

/** Seeded forest islands and planted plots. Roots are sampled from this world's
 * own terrace recipe, so neither flooded paddies nor contour risers acquire trees. */
export function generateFarmLife(seed: number, reserved?:(direction:Vector3,margin:number)=>boolean,site?:CottageSite): FarmLifeLayout {
  const sample=(direction:Vector3)=>site?sampleCottageGround(direction,seed,site):sampleRiceField(direction,seed);
  const rand = randomStream(seed ^ 0x7a46b321);
  const trees: FarmTreeSite[] = [], riceTufts: RiceTuftSite[] = [];
  const groveCentres: Vector3[] = [];
  const phase = rand() * Math.PI * 2;
  const minimumTreeDot = Math.cos(2.65 / RICE_RADIUS);
  for (let i = 0; i < 1200 && trees.length < TREE_LIMIT; i++) {
    // A coprime traversal gives every prefix global coverage. The instance
    // cap must not fill the northern forests before reaching the south.
    const centre = directionAt(i * 479 % 1200, 1200, phase);
    const centreField = sample(centre);
    if (!centreField.forest || centreField.wet) continue;
    if (groveCentres.some(prior => prior.dot(centre) > Math.cos(0.13))) continue;
    groveCentres.push(centre);
    const [x, z] = tangentFrame(centre);
    const members = 10 + Math.floor(rand() * 13);
    const reach = 5 + rand() * 5;
    for (let member = 0; member < members && trees.length < TREE_LIMIT; member++) {
      const angle = rand() * Math.PI * 2, radius = Math.sqrt(rand()) * reach;
      const direction = centre.clone().addScaledVector(x, Math.cos(angle) * radius / RICE_RADIUS).addScaledVector(z, Math.sin(angle) * radius * (0.48 + 0.42 * rand()) / RICE_RADIUS).normalize();
      const field = sample(direction);
      if (!field.forest || field.wet || reserved?.(direction,3) || trees.some(tree => tree.direction.dot(direction) > minimumTreeDot)) continue;
      const size = 0.78 + rand() * 0.66;
      trees.push({
        direction, height: field.surfaceHeight, trunkHeight: (2.35 + rand() * 1.1) * size,
        crownSize: (1.4 + rand() * 0.55) * size, turn: rand() * Math.PI * 2,
        variation: rand(), region: field.region,
      });
    }
  }

  const riceRandom = randomStream(seed ^ 0x34b12a7f);
  const ricePhase = riceRandom() * Math.PI * 2;
  for (let i = 0; i < 17000 && riceTufts.length < RICE_LIMIT; i++) {
    const direction = directionAt(i * 7919 % 17000, 17000, ricePhase);
    const field = sample(direction);
    if (field.wet || field.forest || reserved?.(direction,0.5)) continue;
    // Individual planted plots share density; broad gaps remain between the
    // selected plots instead of a uniform grassy coating over every field.
    const plotDensity = unit(hash32(seed ^ hash32(field.plot + 0x93f1)));
    if (plotDensity < 0.30 || riceRandom() > 0.68) continue;
    const [x, z] = tangentFrame(direction);
    const probe = new Vector3();
    let clear = true;
    for (const tangent of [x, z]) for (const sign of [-1, 1]) {
      const other = sample(probe.copy(direction).addScaledVector(tangent, sign * 0.32 / RICE_RADIUS).normalize());
      if (other.wet || other.forest || other.band !== field.band || other.plot !== field.plot) clear = false;
    }
    if (!clear) continue;
    riceTufts.push({ direction, height: field.surfaceHeight, scale: 0.72 + riceRandom() * 0.56, turn: riceRandom() * Math.PI * 2, variation: riceRandom(), plot: field.plot });
  }
  return { trees, riceTufts };
}

/** Four small tapering blades, bowed along different axes. */
function riceTuftGeometry(): BufferGeometry {
  const positions: number[] = [];
  for (let blade = 0; blade < 4; blade++) {
    const angle = blade * GOLDEN_ANGLE;
    const forward = new Vector3(Math.cos(angle), 0, Math.sin(angle));
    const side = new Vector3(-Math.sin(angle), 0, Math.cos(angle));
    const height = 0.62 + blade * 0.095;
    const point = (step: number, sign: number): Vector3 => {
      const t = step / 4;
      return forward.clone().multiplyScalar(0.018 + 0.19 * t * t).addScaledVector(side, sign * 0.028 * (1 - t)).setY(height * t - 0.10 * t * t * t);
    };
    for (let step = 0; step < 4; step++) {
      const a = point(step, -1), b = point(step, 1), c = point(step + 1, 1), d = point(step + 1, -1);
      positions.push(...a.toArray(), ...b.toArray(), ...c.toArray());
      if (step < 3) positions.push(...a.toArray(), ...c.toArray(), ...d.toArray());
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createFarmLife(seed: number, reserved?:(direction:Vector3,margin:number)=>boolean,site?:CottageSite): { group: Group; stats: { trees: number; riceTufts: number }; dispose(): void } {
  const layout = generateFarmLife(seed,reserved,site), group = new Group();
  group.name = 'Wooded ridge islands and planted rice plots';
  const trunkGeometry = new CylinderGeometry(0.085, 0.145, 1, 5);
  const crownGeometry = new IcosahedronGeometry(1, 1);
  const riceGeometry = riceTuftGeometry();
  const trunkMaterial = new MeshStandardMaterial({ color: '#66513a', roughness: 1, flatShading: true });
  const crownMaterial = new MeshStandardMaterial({ color: '#ffffff', roughness: 1, flatShading: true });
  const riceMaterial = new MeshStandardMaterial({ color: '#ffffff', roughness: 1, side: DoubleSide });
  const trunks = new InstancedMesh(trunkGeometry, trunkMaterial, layout.trees.length);
  const crowns = new InstancedMesh(crownGeometry, crownMaterial, layout.trees.length * 4);
  const rice = new InstancedMesh(riceGeometry, riceMaterial, layout.riceTufts.length);
  trunks.name = 'Slender warm-earth tree trunks'; crowns.name = 'Unequal faceted olive tree crowns'; rice.name = 'Young and mature rice blades';
  const matrix = new Matrix4(), quaternion = new Quaternion(), position = new Vector3(), scale = new Vector3();
  const crownDark = new Color('#34491f'), crownLight = new Color('#647b34');
  const leafDark = new Color('#6c832e'), leafLight = new Color('#a1b94c'), colour = new Color();
  layout.trees.forEach((tree, i) => {
    quaternion.setFromUnitVectors(UP, tree.direction).multiply(new Quaternion().setFromAxisAngle(UP, tree.turn));
    position.copy(tree.direction).multiplyScalar(RICE_RADIUS + tree.height + tree.trunkHeight * 0.5 - 0.035);
    matrix.compose(position, quaternion, scale.set(1, tree.trunkHeight, 1)); trunks.setMatrixAt(i, matrix);
    for (let lobe = 0; lobe < 4; lobe++) {
      const h = hash32(seed ^ Math.imul(i + 1, 3517) ^ Math.imul(lobe + 1, 6571));
      const t = unit(h), angle = lobe * GOLDEN_ANGLE + tree.turn * 0.3;
      const reach = lobe === 0 ? 0 : tree.crownSize * (0.35 + t * 0.20);
      const offset = new Vector3(Math.cos(angle) * reach, tree.trunkHeight + tree.crownSize * (lobe === 0 ? 0.58 : 0.32 + t * 0.28), Math.sin(angle) * reach);
      position.copy(offset).applyQuaternion(quaternion).addScaledVector(tree.direction, RICE_RADIUS + tree.height);
      const lobeScale = tree.crownSize * (lobe === 0 ? 0.96 : 0.65 + t * 0.20);
      matrix.compose(position, quaternion, scale.set(lobeScale * (0.86 + t * 0.25), lobeScale * (0.91 + 0.24 * (1 - t)), lobeScale * (0.84 + t * 0.22)));
      crowns.setMatrixAt(i * 4 + lobe, matrix);
      crowns.setColorAt(i * 4 + lobe, colour.copy(crownDark).lerp(crownLight, tree.variation * 0.60 + t * 0.30));
    }
  });
  layout.riceTufts.forEach((tuft, i) => {
    quaternion.setFromUnitVectors(UP, tuft.direction).multiply(new Quaternion().setFromAxisAngle(UP, tuft.turn));
    position.copy(tuft.direction).multiplyScalar(RICE_RADIUS + tuft.height + 0.025);
    matrix.compose(position, quaternion, scale.setScalar(tuft.scale)); rice.setMatrixAt(i, matrix);
    rice.setColorAt(i, colour.copy(leafDark).lerp(leafLight, tuft.variation));
  });
  for (const mesh of [trunks, crowns, rice]) {
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); mesh.receiveShadow = true;
  }
  trunks.castShadow = true; crowns.castShadow = true;
  group.add(trunks, crowns, rice);
  return {
    group, stats: { trees: layout.trees.length, riceTufts: layout.riceTufts.length },
    dispose() {
      group.removeFromParent(); group.clear();
      for (const mesh of [trunks, crowns, rice]) mesh.dispose();
      for (const geometry of [trunkGeometry, crownGeometry, riceGeometry]) geometry.dispose();
      for (const material of [trunkMaterial, crownMaterial, riceMaterial]) material.dispose();
    },
  };
}
