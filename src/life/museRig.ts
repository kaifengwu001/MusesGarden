import { Euler, Matrix4, Quaternion, Vector3, Vector4 } from 'three';
import { smoothstep } from '../core/math';
import { FIELD_FIT, JOINT, JOINTS, ORDER, PARENT, type ArmTurn, type MuseFit } from './museBody';

// Muse's skeleton and its poses. Every pose is closed-form: a function of
// time and of a few numbers about what Muse is doing (how fast it walks and
// how far it has walked, how far into a wave, where it looks), never of the
// frames before, so a frozen time always draws the same Muse.
//
// The layers, added up per joint as turns (rad, about x, y, z of Muse's
// frame: x to its left, y up, z forward), shifts (H) and scales:
//   idle   breathing, a slow shift of weight, the arms brought in from the
//          mesh's A-pose to hang against the belly
//   walk   a waddle: each foot lifted and set down ahead in turn while the
//          other stays planted, the body rolling over the planted foot and
//          bobbing down onto each step, arms swinging against the legs with
//          a little lag, the head steadied against the roll
//   wave   the left arm thrown up beside the head (as in the reference) with
//          a little overshoot, the forearm waggling, the body leaning away
//          and the head tilting toward it
//   look   the head (and a little of the chest) turned toward a point

/** A step (H): how far ahead a foot is set down, and how high it lifts. */
export const STEP = { length: 0.13, lift: 0.045 } as const;
/** Breathing: period (s) and depth (scale). */
const BREATH = { period: 3.6, depth: 0.014 } as const;
/** The wave's beats: raise, waggle, lower (s), and the waggle's rate (Hz). */
export const WAVE = { raise: 0.55, waggle: 2.1, lower: 0.7, rate: 2.2 } as const;
export const WAVE_LENGTH = WAVE.raise + WAVE.waggle + WAVE.lower;

export interface MuseAction {
  /** World time (s). */
  time: number;
  /** How much of a walk (0 standing … 1 a full stride), how far each step carries the foot ahead (0 stepping on the spot … 1), and the gait's phase (cycles of two steps). */
  walk: number;
  stride: number;
  gait: number;
  /** Seconds into a wave, or < 0 for none. */
  wave: number;
  /** Where the head turns (rad, + to Muse's left, + up), and how much of that it takes (0 … 1). */
  lookYaw: number;
  lookPitch: number;
  look: number;
}

const TAU = Math.PI * 2;
const euler = new Euler();
const q = new Quaternion();
const m = new Matrix4();
const v = new Vector3();

/** Ease out with a little overshoot (back), 0 → 1. */
function easeOutBack(x: number): number {
  const c = 1.6;
  const u = x - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

export class MuseRig {
  /** Per joint: turn (rad about x, y, z, applied y, x, z) and shift (H). The rig is rigid: dual-quaternion skinning (the lab's comparison) wants it so. */
  private readonly turn = new Float64Array(JOINTS * 3);
  private readonly shift = new Float64Array(JOINTS * 3);
  /** Each joint's posed frame, and the skin transforms (as the mesh was made → posed, H): as matrices (muse.vert.glsl, the shadow's) and as dual quaternions, the rotation then the translation part (the lab's comparison). */
  private readonly frame = Array.from({ length: JOINTS }, () => new Matrix4());
  readonly skin = Array.from({ length: JOINTS }, () => new Matrix4());
  readonly dual = Array.from({ length: JOINTS * 2 }, () => new Vector4());
  /** Each joint's frame as the mesh was made (its arms turned as the fit binds them), inverted. */
  private readonly unbind = Array.from({ length: JOINTS }, () => new Matrix4());
  /** The eyes' openness (0 shut … 1 open) and the smile (0 at rest … 1 beaming), for the face's paint. */
  eyes = 1;
  smile = 0;
  /** How far the left arm is up in a wave (0 … 1): the shoulder's corrective plays in with it (museMesh.ts). */
  raised = 0;

  constructor(readonly fit: MuseFit = FIELD_FIT) {
    // the frames the mesh was made in: the skeleton's rest, the arms turned as bound
    this.turn.fill(0);
    this.shift.fill(0);
    this.armTurns(fit.bind, 1);
    this.shoulders();
    this.compute();
    for (let j = 0; j < JOINTS; j++) this.unbind[j].copy(this.frame[j]).invert();
    this.compute();
  }

  /** Turn both arms (the right mirrored) by a share of an arm turn. */
  private armTurns(t: ArmTurn, share: number): void {
    const J = JOINT;
    this.addTurn(J.upperArmL, t.x * share, 0, t.z * share);
    this.addTurn(J.upperArmR, t.x * share, 0, -t.z * share);
    this.addTurn(J.foreArmL, 0, 0, t.fore * share);
    this.addTurn(J.foreArmR, 0, 0, -t.fore * share);
  }

  /** The arms hung as the fit hangs them. */
  private hangArms(): void {
    this.armTurns(this.fit.hang, 1);
  }

  /** Each shoulder takes its share of its upper arm's turn (the turn split, so the two add up to it). */
  private shoulders(): void {
    const s = this.fit.shoulder ?? 0;
    if (s === 0) return;
    for (const [upper, shoulder] of [
      [JOINT.upperArmL, JOINT.shoulderL],
      [JOINT.upperArmR, JOINT.shoulderR],
    ]) {
      for (let a = 0; a < 3; a++) {
        this.turn[shoulder * 3 + a] += s * this.turn[upper * 3 + a];
        this.turn[upper * 3 + a] *= 1 - s;
      }
    }
  }

  /** The arms drawn as long as the fit has them. */
  private reach(): void {
    const r = this.fit.reach ?? 0;
    if (r === 0) return;
    this.stretch(JOINT.upperArmL, JOINT.foreArmL, r);
    this.stretch(JOINT.upperArmR, JOINT.foreArmR, r);
  }

  /** An arm drawn longer (H): its forearm moved out along its upper arm. */
  private stretch(upper: number, fore: number, by: number): void {
    const a = this.fit.rest[upper];
    const b = this.fit.rest[fore];
    const k = by / (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1);
    this.addShift(fore, k * (b[0] - a[0]), k * (b[1] - a[1]), k * (b[2] - a[2]));
  }

  private addTurn(j: number, x: number, y: number, z: number): void {
    this.turn[j * 3] += x;
    this.turn[j * 3 + 1] += y;
    this.turn[j * 3 + 2] += z;
  }

  private addShift(j: number, x: number, y: number, z: number): void {
    this.shift[j * 3] += x;
    this.shift[j * 3 + 1] += y;
    this.shift[j * 3 + 2] += z;
  }

  /** Pose the skeleton for an action and compute the skin matrices. */
  pose(a: MuseAction): void {
    this.turn.fill(0);
    this.shift.fill(0);
    const waving = a.wave >= 0 && a.wave < WAVE_LENGTH;
    this.raised = 0;
    this.reach();
    this.idle(a.time, a.walk);
    if (a.walk > 0) this.walkPose(a.gait, a.walk, a.stride);
    if (waving) this.wavePose(a.wave);
    if (a.look > 0) this.lookPose(a.lookYaw * a.look, a.lookPitch * a.look);
    this.eyes = blink(a.time);
    // a little smile always, beaming while it waves
    this.smile = 0.15 + 0.85 * this.raised;
    this.shoulders();
    this.compute();
  }

  private idle(time: number, walk: number): void {
    const J = JOINT;
    const still = 1 - 0.7 * walk;
    // breathing: the chest rises and opens a touch, the head riding up on it (rigid, as the skinning wants)
    const b = 0.5 - 0.5 * Math.cos((TAU * time) / BREATH.period);
    const d = BREATH.depth * b * still;
    this.addShift(J.chest, 0, d * 0.35, d * 0.25);
    this.addTurn(J.chest, -d * 0.6, 0, 0);
    this.addShift(J.head, 0, d * 0.15, 0);
    // a slow shift of weight from foot to foot, the head keeping level
    const sway = 0.018 * Math.sin((TAU * time) / 8.3) * still;
    this.addTurn(J.pelvis, 0, 0.02 * Math.sin((TAU * time) / 11.7) * still, sway);
    this.addTurn(J.head, 0, 0, -0.6 * sway);
    // the arms hanging against the belly, rising a touch with each breath
    this.hangArms();
    this.addTurn(J.upperArmL, 0, 0, 0.012 * b);
    this.addTurn(J.upperArmR, 0, 0, -0.012 * b);
  }

  private walkPose(gait: number, amount: number, stride: number): void {
    const J = JOINT;
    const w = amount;
    const phase = TAU * gait;
    for (const [leg, offset] of [
      [J.legL, 0],
      [J.legR, 0.5],
    ] as const) {
      // half the cycle swinging forward through the air, half planted and sliding back under the body
      const u = (((gait + offset) % 1) + 1) % 1;
      let z: number;
      let lift = 0;
      let pitch = 0;
      if (u < 0.5) {
        const k = u * 2;
        z = STEP.length * (smoothstep(0, 1, k) - 0.5);
        lift = STEP.lift * Math.sin(Math.PI * k);
        pitch = -0.28 * Math.sin(Math.PI * k);
      } else {
        z = STEP.length * (0.5 - (u - 0.5) * 2);
      }
      this.addShift(leg, 0, lift * w, z * w * stride);
      this.addTurn(leg, pitch * w, 0, 0);
    }
    // the body rolls over the planted foot (the right while the left swings) and bobs down onto each step
    const roll = 0.1 * Math.sin(phase) * w;
    const step = Math.abs(Math.sin(phase));
    this.addTurn(J.pelvis, 0.02 * w, 0.07 * Math.sin(phase) * w, roll);
    this.addShift(J.pelvis, 0, 0.012 * (step - 0.6) * w, 0);
    this.addTurn(J.spine, 0.045 * w, -0.03 * Math.sin(phase) * w, -0.25 * roll);
    // the head steadied against the roll, a beat behind it
    this.addTurn(J.head, 0.02 * w * Math.cos(2 * phase), 0, -0.55 * 0.1 * Math.sin(phase - 0.5) * w);
    // arms swinging against the legs, a little late, flung out a touch by the roll
    const swing = 0.24 * w;
    const late = phase - 0.45;
    this.addTurn(J.upperArmL, swing * Math.cos(late), 0, 0.07 * Math.sin(phase - 0.6) * w);
    this.addTurn(J.upperArmR, -swing * Math.cos(late), 0, 0.07 * Math.sin(phase - 0.6) * w);
    this.addTurn(J.foreArmL, -0.35 * swing * Math.cos(late - 0.7) - 0.08 * w, 0, 0);
    this.addTurn(J.foreArmR, 0.35 * swing * Math.cos(late - 0.7) - 0.08 * w, 0, 0);
  }

  private wavePose(time: number): void {
    const J = JOINT;
    // up with a little overshoot, waggle, down with a settle
    const up = time < WAVE.raise ? easeOutBack(time / WAVE.raise) : 1;
    const downT = time - WAVE.raise - WAVE.waggle;
    const down = downT > 0 ? smoothstep(0, 1, downT / WAVE.lower) : 0;
    const raise = up * (1 - down);
    this.raised = Math.max(0, Math.min(1, raise));
    // a dip before it rises (anticipation)
    const dip = time < WAVE.raise ? -0.12 * Math.sin(Math.PI * Math.min(1, time / (0.3 * WAVE.raise))) * (1 - smoothstep(0.2, 0.35, time / WAVE.raise)) : 0;
    const waggleT = time - WAVE.raise;
    const waggleIn = smoothstep(0, 0.25, waggleT) * (1 - smoothstep(WAVE.waggle - 0.2, WAVE.waggle + 0.1, waggleT));
    const waggle = Math.sin(TAU * WAVE.rate * Math.max(0, waggleT)) * waggleIn;
    // the arm up beside the head as the fit has it (its hang undone as it rises), the hand clear of
    // the face; the waggle swings the forearm about the elbow. (Turns apply about z first: the arm
    // swings up out to the side, then forward or back.)
    const h = this.fit.hang;
    const w = this.fit.wave;
    this.addTurn(J.upperArmL, (w.x - h.x) * raise, w.y * raise, (w.z - h.z) * raise + dip);
    this.addTurn(J.foreArmL, 0, 0, (w.fore - h.fore) * raise + 0.3 * waggle * raise);
    // (stretching a little as it reaches up)
    this.stretch(J.upperArmL, J.foreArmL, (w.reach ?? 0) * raise);
    // the body turns a touch toward you, upright; the head tips a little away from the raised arm (as in the references); the other arm lifts a touch
    this.addTurn(J.spine, 0, 0.05 * raise, 0);
    this.addTurn(J.chest, 0, 0.04 * raise, 0);
    this.addTurn(J.head, 0.04 * raise, 0.06 * raise, 0.08 * raise + 0.03 * waggle * raise);
    this.addTurn(J.upperArmR, 0, 0, -0.08 * raise);
    // the waggle's tremor in the body, barely
    this.addTurn(J.chest, 0, 0, 0.006 * waggle * raise);
  }

  /** The arms hung as the fit hangs them, nothing else moved: a sculpt's roots are measured so (museMesh.ts). */
  hang(): void {
    this.turn.fill(0);
    this.shift.fill(0);
    this.reach();
    this.hangArms();
    this.shoulders();
    this.compute();
  }

  /** The left arm at the top of a wave, nothing else moved: the wave's corrective is measured so (museMesh.ts). */
  raiseLeft(): void {
    const J = JOINT;
    const h = this.fit.hang;
    const w = this.fit.wave;
    this.turn.fill(0);
    this.shift.fill(0);
    this.reach();
    this.stretch(J.upperArmL, J.foreArmL, w.reach ?? 0);
    this.hangArms();
    this.addTurn(J.upperArmL, w.x - h.x, w.y, w.z - h.z);
    this.addTurn(J.foreArmL, 0, 0, w.fore - h.fore);
    this.shoulders();
    this.compute();
  }

  private lookPose(yaw: number, pitch: number): void {
    const J = JOINT;
    const y = Math.max(-1.1, Math.min(1.1, yaw));
    const p = Math.max(-0.35, Math.min(0.3, pitch));
    this.addTurn(J.chest, -0.15 * p, 0.3 * y, 0);
    this.addTurn(J.head, -0.85 * p, 0.6 * y, 0);
  }

  /** A point given in a joint's own frame (the A-pose's axes, about the joint), as posed (H, Muse's frame). */
  posed(joint: number, x: number, y: number, z: number, out: Vector3): Vector3 {
    return out.set(x, y, z).applyMatrix4(this.frame[joint]);
  }

  /** Where each joint is as posed (H, Muse's frame): x, y, z per joint. */
  joints(out = new Float32Array(JOINTS * 3)): Float32Array {
    for (let j = 0; j < JOINTS; j++) {
      const e = this.frame[j].elements;
      out[j * 3] = e[12];
      out[j * 3 + 1] = e[13];
      out[j * 3 + 2] = e[14];
    }
    return out;
  }

  /** Each joint's frame from its parent's, and the skin matrices: posed frame · own scale · back from rest. */
  private compute(): void {
    for (const j of ORDER) {
      const p = PARENT[j];
      const r = this.fit.rest[j];
      // from the parent's joint to this one, shifted in the parent's frame, then turned about itself
      const o = p >= 0 ? this.fit.rest[p] : ORIGIN;
      v.set(r[0] - o[0] + this.shift[j * 3], r[1] - o[1] + this.shift[j * 3 + 1], r[2] - o[2] + this.shift[j * 3 + 2]);
      q.setFromEuler(euler.set(this.turn[j * 3], this.turn[j * 3 + 1], this.turn[j * 3 + 2], 'YXZ'));
      m.compose(v, q, ONE);
      if (p >= 0) this.frame[j].multiplyMatrices(this.frame[p], m);
      else this.frame[j].copy(m);
      this.skin[j].multiplyMatrices(this.frame[j], this.unbind[j]);
      // as a dual quaternion: the turn, and half the translation times it
      const e = this.skin[j].elements;
      dq.setFromRotationMatrix(this.skin[j]);
      const tx = e[12];
      const ty = e[13];
      const tz = e[14];
      this.dual[j * 2].set(dq.x, dq.y, dq.z, dq.w);
      this.dual[j * 2 + 1].set(
        0.5 * (tx * dq.w + ty * dq.z - tz * dq.y),
        0.5 * (-tx * dq.z + ty * dq.w + tz * dq.x),
        0.5 * (tx * dq.y - ty * dq.x + tz * dq.w),
        -0.5 * (tx * dq.x + ty * dq.y + tz * dq.z),
      );
    }
  }

  /**
   * Skin a mesh on the CPU as muse.vert.glsl does (the joints' matrices
   * blended, or with `dual` their dual quaternions, blended and normalised):
   * the lab's stretch view, and checks.
   */
  deform(position: Float32Array, skinIndex: Uint16Array, skinWeight: Float32Array, out: Float32Array, dual = false): Float32Array {
    if (!dual) {
      for (let i = 0; i < position.length / 3; i++) {
        const px = position[i * 3];
        const py = position[i * 3 + 1];
        const pz = position[i * 3 + 2];
        let x = 0;
        let y = 0;
        let z = 0;
        for (let k = 0; k < 4; k++) {
          const w = skinWeight[i * 4 + k];
          if (w === 0) continue;
          const e = this.skin[skinIndex[i * 4 + k]].elements;
          x += w * (e[0] * px + e[4] * py + e[8] * pz + e[12]);
          y += w * (e[1] * px + e[5] * py + e[9] * pz + e[13]);
          z += w * (e[2] * px + e[6] * py + e[10] * pz + e[14]);
        }
        out[i * 3] = x;
        out[i * 3 + 1] = y;
        out[i * 3 + 2] = z;
      }
      return out;
    }
    const d = this.dual;
    for (let i = 0; i < position.length / 3; i++) {
      const j0 = skinIndex[i * 4];
      const r0 = d[j0 * 2];
      let rx = 0;
      let ry = 0;
      let rz = 0;
      let rw = 0;
      let dx = 0;
      let dy = 0;
      let dz = 0;
      let dw = 0;
      for (let k = 0; k < 4; k++) {
        const w = skinWeight[i * 4 + k];
        if (w === 0) continue;
        const j = skinIndex[i * 4 + k];
        const r = d[j * 2];
        const t = d[j * 2 + 1];
        const s = r.x * r0.x + r.y * r0.y + r.z * r0.z + r.w * r0.w < 0 ? -w : w;
        rx += r.x * s;
        ry += r.y * s;
        rz += r.z * s;
        rw += r.w * s;
        dx += t.x * s;
        dy += t.y * s;
        dz += t.z * s;
        dw += t.w * s;
      }
      const l = Math.hypot(rx, ry, rz, rw) || 1;
      rx /= l;
      ry /= l;
      rz /= l;
      rw /= l;
      dx /= l;
      dy /= l;
      dz /= l;
      dw /= l;
      const px = position[i * 3];
      const py = position[i * 3 + 1];
      const pz = position[i * 3 + 2];
      // p + 2 r × (r × p + w p) + 2 (w d − dw r + r × d)
      const cx = ry * pz - rz * py + rw * px;
      const cy = rz * px - rx * pz + rw * py;
      const cz = rx * py - ry * px + rw * pz;
      out[i * 3] = px + 2 * (ry * cz - rz * cy) + 2 * (rw * dx - dw * rx + (ry * dz - rz * dy));
      out[i * 3 + 1] = py + 2 * (rz * cx - rx * cz) + 2 * (rw * dy - dw * ry + (rz * dx - rx * dz));
      out[i * 3 + 2] = pz + 2 * (rx * cy - ry * cx) + 2 * (rw * dz - dw * rz + (rx * dy - ry * dx));
    }
    return out;
  }
}
const dq = new Quaternion();
const ONE = new Vector3(1, 1, 1);
const ORIGIN = [0, 0, 0] as const;

/** The eyes' openness at a time: a blink every few seconds (now and then two), closed-form. */
export function blink(time: number): number {
  const period = 3.7;
  const k = Math.floor(time / period);
  const h = Math.sin(k * 12.9898 + 78.233) * 43758.5453;
  const r = h - Math.floor(h);
  const at = k * period + 0.4 + r * (period - 1.2);
  const one = (dt: number): number => (dt < 0 || dt > 0.18 ? 0 : Math.sin((Math.PI * dt) / 0.18));
  let shut = one(time - at);
  if (r > 0.72) shut = Math.max(shut, one(time - at - 0.3));
  return 1 - shut;
}
