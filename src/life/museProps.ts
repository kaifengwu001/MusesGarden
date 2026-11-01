import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LatheGeometry,
  Line,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type IUniform,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { smoothstep } from '../core/math';
import { travel } from '../planet/geo';
import type { Terrain } from '../planet/terrain';
import { JOINT } from './museBody';
import lineFragment from './museLine.frag.glsl?raw';
import lineVertex from './museLine.vert.glsl?raw';
import moteFragment from './museMotes.frag.glsl?raw';
import moteVertex from './museMotes.vert.glsl?raw';
import fragmentShader from './museProps.frag.glsl?raw';
import vertexShader from './museProps.vert.glsl?raw';
import { COOK, FISH, STIR, cookBeats, fishBeats, gardenBeats, sleepBeats, type MuseRig } from './museRig';
import { STOVE, type Roaming } from './museRoam';
import { FLOOR } from './props';

// Muse's things in the meadow (muse.ts places them each frame): the little
// stove that stands on the porch with its pot, and what Muse takes out of its
// belly pocket, holds and puts back (a watering can, a fishing rod with its
// line, float and the odd fish, a ladle), and the little things that float
// about it (its snore bubble, Zzz, hearts as you pet it, notes as it hums,
// the pot's steam, drops of water). They are as the lab's stage has them
// (museStage.ts), in Muse's heights, set in planet space by its frame and
// its mittens, painted and lit like the meadow (museProps.frag.glsl) and
// warped like everything else. Rings spread on the water where the float
// lands and the fish goes back in (onRipple: the meadow's own ripples).

/** The motes' sheet of pictures, in a row: Zzz, a heart, a note, a puff of steam, a drop of water, a bubble. */
const PICTURES = ['Z', '♥', '♪', 'puff', 'drop', 'bubble'] as const;
const MOTES = 32;
/** Where the float lands, ahead of Muse (× its height). */
const CAST = 1.25;

type Part = [geometry: BufferGeometry, colour: number, at?: Matrix4, glow?: boolean];

/** One geometry from parts, each painted its colour (aColour, linear) and glowing or not (aGlow). */
function build(parts: Part[]): BufferGeometry {
  const pieces = parts.map(([g, colour, at, glow]) => {
    const p = g.index ? g.toNonIndexed() : g.clone();
    if (at) p.applyMatrix4(at);
    p.deleteAttribute('uv');
    const n = p.getAttribute('position').count;
    const c = new Color(colour);
    const rgb = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) rgb.set([c.r, c.g, c.b], i * 3);
    p.setAttribute('aColour', new BufferAttribute(rgb, 3));
    p.setAttribute('aGlow', new BufferAttribute(new Float32Array(n).fill(glow ? 1 : 0), 1));
    return p;
  });
  const merged = mergeGeometries(pieces);
  if (!merged) throw new Error('museProps: parts could not be merged');
  return merged;
}

const at = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1): Matrix4 =>
  new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(sx, sy, sz));

/** The motes' pictures, drawn once on a canvas: each in its square, outlined in white where it is a glyph. */
function motesSheet(): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size * PICTURES.length;
  canvas.height = size;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('museProps: no 2d canvas');
  const glyph = (k: number, text: string, fill: string): void => {
    g.font = `bold ${Math.round(size * 0.78)}px "Arial Rounded MT Bold", "Avenir Next", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.lineWidth = size * 0.09;
    g.strokeStyle = 'rgba(255,255,255,0.95)';
    g.strokeText(text, k * size + size / 2, size * 0.54);
    g.fillStyle = fill;
    g.fillText(text, k * size + size / 2, size * 0.54);
  };
  const disc = (k: number, stops: [number, string][]): void => {
    const f = g.createRadialGradient(k * size + size / 2, size / 2, 0, k * size + size / 2, size / 2, size / 2);
    for (const [o, c] of stops) f.addColorStop(o, c);
    g.fillStyle = f;
    g.fillRect(k * size, 0, size, size);
  };
  glyph(0, 'Z', '#7f9fd6');
  glyph(1, '♥', '#f2789c');
  glyph(2, '♪', '#8a6fd0');
  disc(3, [
    [0, 'rgba(255,255,255,0.95)'],
    [0.5, 'rgba(255,255,255,0.5)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  disc(4, [
    [0, 'rgba(200,232,255,1)'],
    [0.45, 'rgba(150,205,240,0.9)'],
    [0.7, 'rgba(150,205,240,0)'],
  ]);
  // the bubble: clear, a bright rim, a glint
  disc(5, [
    [0, 'rgba(200,225,255,0.12)'],
    [0.78, 'rgba(200,225,255,0.22)'],
    [0.9, 'rgba(235,245,255,0.85)'],
    [0.98, 'rgba(235,245,255,0)'],
  ]);
  g.fillStyle = 'rgba(255,255,255,0.95)';
  g.beginPath();
  g.ellipse(5 * size + size * 0.34, size * 0.32, size * 0.09, size * 0.06, -0.6, 0, Math.PI * 2);
  g.fill();
  const t = new CanvasTexture(canvas);
  t.colorSpace = 'srgb';
  return t;
}

export class MuseProps {
  readonly group = new Group();
  /** Rings on the water where something touches it (planet direction, world time): the meadow's ripples. */
  onRipple: ((dir: Vector3, time: number) => void) | null = null;
  private readonly material: ShaderMaterial;
  private readonly glow = new Vector3(1, 0.55, 0.2);
  private readonly can: Mesh;
  private readonly rod: Mesh;
  private readonly ladle: Mesh;
  private readonly float: Mesh;
  private readonly fish: Mesh;
  private readonly stove: Mesh;
  private readonly line: Line;
  private readonly motes: Mesh;
  private readonly moteAt: InstancedBufferAttribute;
  private readonly moteLook: InstancedBufferAttribute;
  private moteCount = 0;
  /** Splashes already sent (their time), so each is sent once. */
  private readonly splashed = new Set<number>();

  constructor(shared: Record<string, IUniform>) {
    this.material = new ShaderMaterial({ name: 'muse props', vertexShader, fragmentShader, uniforms: { ...shared, uGlow: { value: this.glow } }, side: DoubleSide });
    const mesh = (geometry: BufferGeometry): Mesh => {
      const m = new Mesh(geometry, this.material);
      m.matrixAutoUpdate = false;
      m.frustumCulled = false;
      m.visible = false;
      this.group.add(m);
      return m;
    };
    // the watering can: a body, a spout with its rose, a handle over the top (Muse's heights)
    const mint = 0x8ec5c0;
    this.can = mesh(
      build([
        [new CylinderGeometry(0.07, 0.078, 0.13, 18), mint],
        [new CylinderGeometry(0.011, 0.016, 0.17, 8), mint, at(0, 0, 0.1, 1.0)],
        [new ConeGeometry(0.025, 0.035, 10, 1, true), mint, at(0, 0.06, 0.17, -2.1)],
        [new TorusGeometry(0.055, 0.011, 6, 16, Math.PI), mint, at(0, 0.065, -0.01, 0, Math.PI / 2)],
      ]),
    );
    // the rod (its grip at the mitten), its reel
    this.rod = mesh(
      build([
        [new CylinderGeometry(0.006, 0.012, ROD.length, 6), 0xd8b86a, at(0, ROD.length / 2 - ROD.grip, 0)],
        [new CylinderGeometry(0.026, 0.026, 0.02, 12), 0x8a5a3a, at(0.02, 0.02, 0, 0, 0, Math.PI / 2)],
      ]),
    );
    // the ladle: its bowl at the origin, the handle up from it
    this.ladle = mesh(
      build([
        [new CylinderGeometry(0.009, 0.009, LADLE, 6), 0x9b6b45, at(0, LADLE / 2, 0)],
        [new SphereGeometry(0.035, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xb8bcc2],
      ]),
    );
    this.float = mesh(
      build([
        [new SphereGeometry(0.03, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xe2483a],
        [new SphereGeometry(0.03, 12, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0xf6f2ea],
      ]),
    );
    this.fish = mesh(
      build([
        [new SphereGeometry(0.05, 14, 10), 0xff9a3c, at(0, 0, 0, 0, 0, 0, 1.5, 1, 0.6)],
        [new ConeGeometry(0.035, 0.06, 4), 0xff9a3c, at(-0.09, 0, 0, 0, 0, Math.PI / 2, 1, 1, 0.3)],
        [new SphereGeometry(0.008, 6, 4), 0x111111, at(0.045, 0.012, -0.025)],
        [new SphereGeometry(0.008, 6, 4), 0x111111, at(0.045, 0.012, 0.025)],
      ]),
    );
    // the stove on the porch (meters): an iron box on short legs, its fire's window to the front, a pipe, a pot of soup
    const iron = 0x3c3a3a;
    const pot = [new Vector2(0, -0.2), new Vector2(0.15, -0.195), new Vector2(0.19, -0.13), new Vector2(0.195, -0.03), new Vector2(0.18, 0), new Vector2(0.2, 0.008), new Vector2(0.195, 0.022)];
    this.stove = mesh(
      build([
        [new BoxGeometry(0.5, 0.38, 0.42), iron, at(0, 0.24, 0)],
        ...[-1, 1].flatMap((sx) => [-1, 1].map((sz): Part => [new BoxGeometry(0.05, 0.06, 0.05), iron, at(sx * 0.21, 0.03, sz * 0.17)])),
        [new BoxGeometry(0.54, 0.03, 0.46), 0x2e2c2c, at(0, 0.445, 0)],
        [new BoxGeometry(0.2, 0.12, 0.012), 0xff9a50, at(0, 0.21, 0.212), true],
        [new CylinderGeometry(0.05, 0.05, 0.8, 10), iron, at(0.17, 0.82, -0.15)],
        [new LatheGeometry(pot, 20), 0x46413f, at(-0.04, 0.66, 0)],
        [new CircleGeometry(0.18, 20), 0xd9893f, at(-0.04, 0.64, 0, -Math.PI / 2)],
      ]),
    );
    this.stove.visible = true;
    // the fishing line
    const lineGeometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(new Float32Array(LINE * 3), 3));
    this.line = new Line(lineGeometry, new ShaderMaterial({ name: 'muse line', vertexShader: lineVertex, fragmentShader: lineFragment, uniforms: { ...shared }, transparent: true }));
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.group.add(this.line);
    // the motes: squares facing the camera
    const quad = new InstancedBufferGeometry().copy(new PlaneGeometry(1, 1) as unknown as InstancedBufferGeometry);
    this.moteAt = new InstancedBufferAttribute(new Float32Array(MOTES * 4), 4);
    this.moteLook = new InstancedBufferAttribute(new Float32Array(MOTES * 4), 4);
    quad.setAttribute('aMote', this.moteAt);
    quad.setAttribute('aLook', this.moteLook);
    quad.instanceCount = 0;
    this.motes = new Mesh(
      quad,
      new ShaderMaterial({
        name: 'muse motes',
        vertexShader: moteVertex,
        fragmentShader: moteFragment,
        uniforms: { ...shared, uMotes: { value: motesSheet() }, uMoteCount: { value: PICTURES.length } },
        transparent: true,
        depthWrite: false,
      }),
    );
    this.motes.frustumCulled = false;
    this.motes.renderOrder = 4;
    this.group.add(this.motes);
  }

  /** Add a mote: where (planet space), how big (m), which picture, how opaque, its turn. */
  private mote(p: Vector3, size: number, picture: number, alpha: number, spin = 0): void {
    if (this.moteCount >= MOTES || alpha <= 0.01) return;
    this.moteAt.setXYZW(this.moteCount, p.x, p.y, p.z, size);
    this.moteLook.setXYZW(this.moteCount, picture, alpha, spin, 0);
    this.moteCount++;
  }

  /** Rings where something touched the water at a time (sent once). */
  private splash(dir: Vector3, time: number, now: number): void {
    const key = Math.round(time * 100);
    if (time > now || now - time > 2 || this.splashed.has(key)) return;
    this.splashed.add(key);
    if (this.splashed.size > 64) this.splashed.delete(this.splashed.values().next().value as number);
    this.onRipple?.(dir, time);
  }

  /**
   * The props at a time: the stove where it stands on the porch, and what
   * Muse holds and makes as its life has it (l), from its pose (rig) and its
   * place (place: its frame on the planet, scaled by its height H). shown:
   * whether Muse is drawn (its things go with it).
   */
  update(time: number, l: Roaming | null, rig: MuseRig, place: Matrix4, terrain: Terrain, H: number, shown: boolean): void {
    const R = terrain.radius;
    // the stove: at its place on the porch, standing square to the floor there
    {
      const L = terrain.layout;
      const X = v1.crossVectors(L.cottage, L.homeBearing).normalize();
      const Z = v2.crossVectors(X, L.cottage).normalize();
      const d = Math.hypot(STOVE.x, STOVE.z);
      const out = v3.copy(X).multiplyScalar(STOVE.x / d).addScaledVector(Z, STOVE.z / d);
      const up = travel(L.cottage, out, Math.asin(Math.min(d / R, 1)), v4);
      const x = v5.copy(X).addScaledVector(up, -X.dot(up)).normalize();
      const z = v6.crossVectors(x, up);
      this.stove.matrix.makeBasis(x, up, z).setPosition(up.x * (R + terrain.cottageGround + FLOOR), up.y * (R + terrain.cottageGround + FLOOR), up.z * (R + terrain.cottageGround + FLOOR));
      this.stove.matrixWorldNeedsUpdate = true;
    }
    this.moteCount = 0;
    const cues = l?.cues;
    const on = shown && !!l;
    // Muse's frame: its basis (unit: to its left, up, forward); a mitten as placed
    const e = place.elements;
    const up = v1.set(e[4], e[5], e[6]).divideScalar(H);
    const forward = v2.set(e[8], e[9], e[10]).divideScalar(H);
    const basis = m1.makeBasis(v3.set(e[0], e[1], e[2]).divideScalar(H), up, forward);
    const mitten = m2.multiplyMatrices(place, rig.handFrame(-1, m3));
    const hand = v4.set(mitten.elements[12], mitten.elements[13], mitten.elements[14]);
    /** A thing held in the right mitten: turned as Muse faces, then by its own turn, set off from its grip (× H), scaled by H. */
    const holding = (turn: Euler, grip: Vector3, out: Matrix4): Matrix4 =>
      out
        .copy(basis)
        .multiply(m4.makeRotationFromEuler(turn))
        .multiply(m5.makeTranslation(grip.x * H, grip.y * H, grip.z * H))
        .scale(v5.set(H, H, H))
        .setPosition(
          hand.x + out.elements[12],
          hand.y + out.elements[13],
          hand.z + out.elements[14],
        );
    const hold = (mesh: Mesh, m: Matrix4, grip: number): void => {
      mesh.visible = on && grip > 0.01;
      if (!mesh.visible) return;
      // (it pops into being as it comes out of the pocket, and out as it goes back in)
      const pop = Math.max(1e-3, Math.min(1, grip) * (1 + 0.25 * Math.sin(Math.PI * Math.min(1, grip))));
      mesh.matrix.copy(m).scale(v6.set(pop, pop, pop));
      mesh.matrixWorldNeedsUpdate = true;
    };

    // the watering can, hung by its handle, tipped to pour; its water falling on the plants before it
    const w = cues?.water ?? null;
    const tip = w ? gardenBeats(w.time).tip : 0;
    const canAt = holding(new Euler(0.1 + 0.8 * tip, 0, 0), new Vector3(0, -0.122, 0.012), m6);
    hold(this.can, canAt, w ? w.grip : 0);
    const pour = w && on ? gardenBeats(w.time).pour : 0;
    if (pour > 0.05) {
      const rose = v7.set(0, 0.07, 0.19).applyMatrix4(canAt);
      const ground = v8.copy(rose).addScaledVector(forward, 0.12 * H);
      const g = ground.length();
      ground.multiplyScalar((R + terrain.height(v9.copy(ground).normalize())) / g);
      for (let i = 0; i < 14; i++) {
        const f = (((time * 1.6 + i / 14) % 1) + 1) % 1;
        const p = v9.copy(rose).lerp(ground, f).addScaledVector(up, -0.15 * H * f * f + 0.06 * H * f * (1 - f));
        p.addScaledVector(forward, 0.02 * H * Math.sin(i * 7.7));
        this.mote(p, 0.03 * H, 4, pour * (1 - 0.3 * f));
      }
    }

    // the ladle: from the mitten down to its bowl going round in the pot, or (tasting) up to its bowl before its mouth
    const c = cues?.cook ?? null;
    const beat = c ? cookBeats(c.time) : { turn: 0, taste: 0, blow: 0 };
    const potMiddle = v7.setFromMatrixPosition(this.stove.matrix);
    const potUp = v8.set(this.stove.matrix.elements[4], this.stove.matrix.elements[5], this.stove.matrix.elements[6]);
    const potX = v9.set(this.stove.matrix.elements[0], this.stove.matrix.elements[1], this.stove.matrix.elements[2]);
    const potZ = v10.set(this.stove.matrix.elements[8], this.stove.matrix.elements[9], this.stove.matrix.elements[10]);
    const soup = v11.copy(potMiddle).addScaledVector(potUp, 0.63).addScaledVector(potX, -0.04);
    if (c && on) {
      const head = m4.multiplyMatrices(place, rig.frameOf(JOINT.head, m5));
      const mouth = v12.set(0, 0.01, 0.27).applyMatrix4(head);
      const inPot = v13
        .copy(soup)
        .addScaledVector(potX, STIR.bowl * H * Math.cos(beat.turn))
        .addScaledVector(potZ, STIR.bowl * H * Math.sin(beat.turn));
      const bowl = inPot.lerp(mouth, beat.taste);
      const handle = v14.subVectors(hand, bowl);
      const working = smoothstep(0.2, 0.9, c.time) * smoothstep(0.2, 0.9, COOK.period * 2 - c.time);
      const along = handle.lengthSq() > 1e-8 ? handle.normalize().lerp(up, 1 - working).normalize() : up;
      const reach = Math.min(LADLE * H - 0.05, hand.distanceTo(bowl));
      const q = new Quaternion().setFromUnitVectors(v15.set(0, 1, 0), along);
      m6.compose(v16.copy(hand).addScaledVector(along, -(working * reach + (1 - working) * 0.3 * H)), q, v17.set(H, H, H));
      hold(this.ladle, m6, c.grip);
    } else this.ladle.visible = false;
    // the stove's fire, glowing while it cooks, embers otherwise; steam off the pot as it cooks
    const cooking = c ? 1 : 0;
    const flicker = 0.85 + 0.25 * Math.sin(time * 11) * Math.sin(time * 7.3);
    this.glow.set(1.4, 0.8, 0.35).multiplyScalar((0.25 + 0.75 * cooking) * flicker);
    if (cooking) {
      for (let k = 0; k < 7; k++) {
        const u = (((time / 2.8 + k / 7) % 1) + 1) % 1;
        const p = v12
          .copy(soup)
          .addScaledVector(potUp, 0.03 + 0.7 * u)
          .addScaledVector(potX, 0.08 * Math.sin(u * 5 + k) + 0.12 * u)
          .addScaledVector(potZ, 0.06 * Math.cos(u * 4 + k * 2));
        this.mote(p, 0.12 + 0.28 * u, 3, 0.55 * Math.sin(Math.PI * Math.min(1, u * 1.4)) * (1 - u));
      }
    }

    // the rod, its line out to the float on the water, or the fish hung on it; rings where they touch the water
    const fsh = cues?.fish ?? null;
    const fu = fsh ? ((fsh.time % FISH.period) + FISH.period) % FISH.period : 0;
    const beats = fsh ? fishBeats(fsh.time) : { cast: 0, dip: 0, yank: 0, fish: 0, free: 0 };
    const swing = fsh ? 0.9 * Math.sin(Math.PI * Math.min(1, Math.max(0, fu - FISH.cast[0]) / 0.7)) * (fu < 0.7 ? 1 : 0) : 0;
    const rodAt = holding(new Euler(0.75 - 0.35 * beats.yank - swing, 0, 0.12), new Vector3(0, 0, 0), m6);
    hold(this.rod, rodAt, fsh ? fsh.grip : 0);
    const holdingRod = this.rod.visible && !!fsh && fsh.grip > 0.98;
    this.line.visible = this.float.visible = holdingRod;
    this.fish.visible = false;
    if (fsh && holdingRod && l) {
      const rodTip = v12.set(0, ROD.length - ROD.grip, 0).applyMatrix4(rodAt);
      // where the float rests on the water, ahead of Muse
      const landingDir = travel(l.dir, l.heading, (CAST * H) / R, v13);
      const landing = v14.copy(landingDir).multiplyScalar(R + 0.012);
      const bob = 0.006 * H * Math.sin(time * 2.3) - 0.05 * H * beats.dip;
      const floatAt = v15;
      if (beats.fish > 0) {
        // the fish flying out on the line, then hung from the rod's tip, wriggling
        const hang = v16.copy(rodTip).addScaledVector(up, -0.26 * H);
        floatAt.lerpVectors(landing, hang, beats.fish).addScaledVector(up, 0.35 * H * Math.sin(Math.PI * beats.fish));
      } else if (fu < FISH.cast[1]) {
        floatAt.lerpVectors(rodTip, landing, beats.cast).addScaledVector(up, 0.3 * H * Math.sin(Math.PI * beats.cast));
      } else floatAt.copy(landing).addScaledVector(up, bob);
      this.float.matrix.compose(floatAt, q0, v16.set(H, H, H));
      this.float.matrixWorldNeedsUpdate = true;
      // the line: the tip to the float, sagging a little
      const pts = this.line.geometry.getAttribute('position');
      for (let i = 0; i < LINE; i++) {
        const f = i / (LINE - 1);
        const p = v16.copy(rodTip).lerp(floatAt, f).addScaledVector(up, -0.08 * H * Math.sin(Math.PI * f) * (beats.fish > 0 || beats.yank > 0.5 ? 0.1 : 1));
        pts.setXYZ(i, p.x, p.y, p.z);
      }
      pts.needsUpdate = true;
      // the fish: on the line while caught, dropped back in when let go
      if (beats.fish > 0.02 || (beats.free > 0 && beats.free < 1)) {
        const fishAt = v16;
        let roll: number;
        if (beats.fish > 0.02) {
          fishAt.copy(floatAt).addScaledVector(up, -0.07 * H);
          roll = -1.2 + 0.5 * Math.sin(time * 14);
        } else {
          fishAt.copy(rodTip).addScaledVector(up, -0.33 * H).lerp(landing, beats.free).addScaledVector(up, 0.2 * H * Math.sin(Math.PI * beats.free));
          roll = -1.2 + 2.6 * beats.free;
        }
        // (side on to Muse, its nose down as it hangs)
        const side = v17.crossVectors(up, forward);
        m4.makeBasis(forward, up, side.negate()).multiply(m5.makeRotationZ(roll));
        this.fish.matrix.copy(m4).scale(v18.set(H, H, H)).setPosition(fishAt);
        this.fish.matrixWorldNeedsUpdate = true;
        this.fish.visible = true;
      }
      // rings on the water: the float landing, the nibbles, the bite, the fish dropped back
      const cycle = time - fu;
      for (const [t, strength] of [
        [FISH.cast[1] - 0.02, 1],
        [FISH.nibble[0], 0.6],
        [FISH.nibble[1], 0.7],
        [FISH.bite, 1],
        [FISH.free + 0.5, 1.2],
      ] as const) {
        if (strength > 0) this.splash(landingDir, cycle + t, time);
      }
    }

    // its snore bubble at its nose, blown and drawn back with each breath, popped when it stirs or wakes; Zzz; hearts; notes
    if (on && cues) {
      const head = m4.multiplyMatrices(place, rig.frameOf(JOINT.head, m5));
      const top = v12.set(0, 0.15, 0.05).applyMatrix4(head);
      const sl = cues.sleep;
      if (sl) {
        const pop = sl.roused >= 0 ? smoothstep(0, 0.18, sl.roused) : 0;
        const r = (0.015 + 0.075 * sleepBeats(sl.time).bubble) * (1 + 0.6 * pop) * H;
        const nose = v13.set(-0.01, 0.0, 0.23 + (0.85 * r) / H).applyMatrix4(head);
        this.mote(nose, 2 * r, 5, 1 - pop);
        if (sl.roused < 0 || sl.roused > 1.5) {
          for (let k = 0; k < 3; k++) {
            const u = (((time / 3 + k / 3) % 1) + 1) % 1;
            const p = v13.copy(top).addScaledVector(up, (0.15 + 0.5 * u) * H).addScaledVector(v14.crossVectors(up, forward), (0.18 * u + 0.05 * Math.sin(u * 6)) * H);
            this.mote(p, (0.08 + 0.12 * u) * H, 0, Math.sin(Math.PI * Math.min(1, u * 1.2)), 0.2 * Math.sin(u * 5));
          }
        }
      }
      if (cues.petted > 0.4) {
        for (let k = 0; k < 3; k++) {
          const u = (((time / 1.6 + k / 3) % 1) + 1) % 1;
          const p = v13.copy(top).addScaledVector(up, (0.12 + 0.45 * u) * H).addScaledVector(v14.crossVectors(up, forward), 0.22 * H * Math.sin(k * 2.1 + u * 2));
          this.mote(p, 0.13 * H, 1, Math.sin(Math.PI * u) * smoothstep(0.4, 0.8, cues.petted));
        }
      }
      if (cues.hum > 0.05) {
        for (let k = 0; k < 3; k++) {
          const u = (((time / 2.2 + k / 3) % 1) + 1) % 1;
          const p = v13.copy(top).addScaledVector(up, (0.1 + 0.45 * u) * H).addScaledVector(v14.crossVectors(up, forward), (-0.15 + 0.3 * u + 0.05 * Math.sin(u * 9)) * H);
          this.mote(p, 0.14 * H, 2, cues.hum * Math.sin(Math.PI * u), 0.15 * Math.sin(u * 7));
        }
      }
    }
    this.moteAt.needsUpdate = true;
    this.moteLook.needsUpdate = true;
    (this.motes.geometry as InstancedBufferGeometry).instanceCount = this.moteCount;
    this.motes.visible = this.moteCount > 0;
  }
}

/** The rod (Muse's heights): its length and how far up it its grip is; the ladle's handle; the line's points. */
const ROD = { length: 0.95, grip: 0.12 } as const;
const LADLE = 0.44;
const LINE = 16;
const q0 = new Quaternion();
const m1 = new Matrix4();
const m2 = new Matrix4();
const m3 = new Matrix4();
const m4 = new Matrix4();
const m5 = new Matrix4();
const m6 = new Matrix4();
const v1 = new Vector3();
const v2 = new Vector3();
const v3 = new Vector3();
const v4 = new Vector3();
const v5 = new Vector3();
const v6 = new Vector3();
const v7 = new Vector3();
const v8 = new Vector3();
const v9 = new Vector3();
const v10 = new Vector3();
const v11 = new Vector3();
const v12 = new Vector3();
const v13 = new Vector3();
const v14 = new Vector3();
const v15 = new Vector3();
const v16 = new Vector3();
const v17 = new Vector3();
const v18 = new Vector3();
