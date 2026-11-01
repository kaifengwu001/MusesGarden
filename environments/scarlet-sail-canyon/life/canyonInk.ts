import { Color, Float32BufferAttribute, InstancedBufferAttribute, InstancedBufferGeometry, LineSegments, ShaderMaterial, Vector3, type BufferGeometry, type IUniform } from 'three';
import vertexShader from './canyonInk.vert.glsl?raw';
import fragmentShader from './canyonInk.frag.glsl?raw';

export interface CanyonInkAttributes {
  aAnchor: InstancedBufferAttribute;
  aAcross: InstancedBufferAttribute;
  aPlacement: InstancedBufferAttribute;
  aHeightScale: InstancedBufferAttribute;
}

export interface CanyonInk {
  mesh: LineSegments<InstancedBufferGeometry, ShaderMaterial>;
  geometry: InstancedBufferGeometry;
  material: ShaderMaterial;
  syncInstanceCount(count: number): void;
  dispose(): void;
}

interface Edge {
  from: number;
  to: number;
  kind: number;
  normalA: Vector3;
  normalB?: Vector3;
}

const WELD_PRECISION = 100_000;
const ROCK_CREASE_COS = Math.cos(28 * Math.PI / 180);
const WOOD_CREASE_COS = Math.cos(78 * Math.PI / 180);
const MIN_BEND_COS = Math.cos(1.5 * Math.PI / 180);

/** Real boundaries and face adjacency, welded by position rather than UV seams.
 * Fan/fern/lichen triangles contribute only their outer boundary. Curved wood
 * keeps candidate silhouettes, not an always-visible line on every tube strip.
 */
export function canyonInkGeometry(source: BufferGeometry): InstancedBufferGeometry {
  const position = source.getAttribute('position');
  const uv = source.getAttribute('uv');
  const kind = source.getAttribute('aKind');
  const plantBase = source.getAttribute('aPlantBase');
  if (!position || !uv || !kind) throw new Error('Canyon ink requires position, uv and aKind attributes.');
  // Embedded shelf planting is tiny and already patterned by the plant shader.
  // Outline that batch's large rock mass; standalone foliage keeps its contours.
  let containsRock = false;
  for (let i = 0; i < kind.count; i++) if (kind.getX(i) > 1.5 && kind.getX(i) < 2.5) { containsRock = true; break; }
  const vertexKey = (index: number): string => [position.getX(index), position.getY(index), position.getZ(index)].map(value => Math.round(value * WELD_PRECISION)).join(',');
  const keys = Array.from({ length: position.count }, (_, i) => vertexKey(i));
  const edges = new Map<string, Edge>();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const index = source.getIndex();
  const vertexAt = (i: number): number => index ? index.getX(i) : i;
  for (let i = 0; i < (index?.count ?? position.count); i += 3) {
    const ids = [vertexAt(i), vertexAt(i + 1), vertexAt(i + 2)];
    a.fromBufferAttribute(position, ids[0]);
    b.fromBufferAttribute(position, ids[1]);
    c.fromBufferAttribute(position, ids[2]);
    const normal = b.sub(a).cross(c.sub(a));
    if (normal.lengthSq() < 1e-14) continue;
    normal.normalize();
    const materialKind = kind.getX(ids[0]);
    for (let edge = 0; edge < 3; edge++) {
      const from = ids[edge], to = ids[(edge + 1) % 3];
      if (keys[from] === keys[to]) continue;
      const key = `${materialKind}:${keys[from] < keys[to] ? `${keys[from]}/${keys[to]}` : `${keys[to]}/${keys[from]}`}`;
      const previous = edges.get(key);
      if (previous) previous.normalB = normal.clone();
      else edges.set(key, { from, to, kind: materialKind, normalA: normal.clone() });
    }
  }

  const positions: number[] = [], uvs: number[] = [], kinds: number[] = [], plantBases: number[] = [];
  const normalsA: number[] = [], normalsB: number[] = [], rules: number[] = [];
  for (const edge of edges.values()) {
    const foliage = edge.kind > 0.5 && edge.kind < 1.5 || edge.kind > 2.5 && edge.kind < 4.5 || edge.kind > 7.5;
    if (containsRock && foliage) continue;
    const boundary = edge.normalB === undefined;
    if (foliage && !boundary) continue;
    const normalB = edge.normalB ?? edge.normalA;
    const cosine = edge.normalA.dot(normalB);
    if (!boundary && cosine > MIN_BEND_COS) continue;
    const wood = edge.kind < 0.5 || edge.kind > 4.5 && edge.kind < 5.5;
    const crease = !boundary && cosine < (wood ? WOOD_CREASE_COS : ROCK_CREASE_COS);
    // Rule 0 is visible only where the adjacent faces straddle the view ray.
    const rule = boundary || crease ? 1 : 0;
    for (const vertex of [edge.from, edge.to]) {
      positions.push(position.getX(vertex), position.getY(vertex), position.getZ(vertex));
      uvs.push(uv.getX(vertex), uv.getY(vertex));
      kinds.push(edge.kind);
      plantBases.push(plantBase?.getX(vertex) ?? 0);
      normalsA.push(edge.normalA.x, edge.normalA.y, edge.normalA.z);
      normalsB.push(normalB.x, normalB.y, normalB.z);
      rules.push(rule);
    }
  }
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aKind', new Float32BufferAttribute(kinds, 1));
  geometry.setAttribute('aPlantBase', new Float32BufferAttribute(plantBases, 1));
  geometry.setAttribute('aInkNormalA', new Float32BufferAttribute(normalsA, 3));
  geometry.setAttribute('aInkNormalB', new Float32BufferAttribute(normalsB, 3));
  geometry.setAttribute('aInkRule', new Float32BufferAttribute(rules, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

/** Add this alongside its source batch. Pass the scenery material's uniforms
 * (including its uSceneryTime object), not a newly-created clock. When source
 * is the instanced scenery geometry, counts follow it on every draw. Placement
 * attributes are borrowed by identity and updated by CanyonScenery as usual.
 */
export function makeCanyonInk(source: BufferGeometry, shared: Record<string, IUniform>, attrs?: CanyonInkAttributes): CanyonInk {
  const attributes = attrs ?? {
    aAnchor: source.getAttribute('aAnchor'),
    aAcross: source.getAttribute('aAcross'),
    aPlacement: source.getAttribute('aPlacement'),
    aHeightScale: source.getAttribute('aHeightScale'),
  };
  for (const [name, attribute] of Object.entries(attributes)) {
    if (!(attribute instanceof InstancedBufferAttribute)) throw new Error(`Canyon ink requires the source batch's ${name} instance attribute.`);
  }
  if (!shared.uSceneryTime) throw new Error('Canyon ink must share the scenery clock.');
  const geometry = canyonInkGeometry(source);
  for (const [name, attribute] of Object.entries(attributes)) geometry.setAttribute(name, attribute);
  const count = source instanceof InstancedBufferGeometry ? source.instanceCount : attributes.aAnchor.count;
  geometry.instanceCount = Number.isFinite(count) ? count : attributes.aAnchor.count;
  const material = new ShaderMaterial({
    name: 'scarlet-canyon-ink', vertexShader, fragmentShader,
    uniforms: { ...shared, uInkColor: { value: new Color('#334859') }, uInkOpacity: { value: 0.35 } },
    transparent: true, depthWrite: false, depthTest: true,
  });
  const mesh = new LineSegments(geometry, material);
  mesh.name = 'Restrained canyon silhouette and fracture ink';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  if (source instanceof InstancedBufferGeometry) mesh.onBeforeRender = () => { geometry.instanceCount = source.instanceCount; };
  return {
    mesh, geometry, material,
    syncInstanceCount: count => { geometry.instanceCount = Math.max(0, Math.min(attributes.aAnchor.count, count)); },
    dispose: () => { mesh.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}
