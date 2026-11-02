import type { Scene, Vector3 } from 'three';
import type { BuildQueue } from './core/buildQueue';
import type { FrameClock } from './core/clock';
import type { Tier } from './core/quality';
import type { ParamPath } from './params';
import type { ChunkSelection } from './planet/chunks';
import type { GrowthState } from './planet/growth';
import type { CameraRig } from './view/camera';
import type { Pick } from './view/picking';

/** The planets you can visit: the meadow (Muse's home) and the terraces. */
export type PlanetKind = 'meadow' | 'terraces';

/** Named views every planet frames its own way (the shots and the tests cut to them). */
export type CameraPreset = 'homestead' | 'lakes' | 'meadow' | 'vista' | 'muse';

/**
 * What the frame loop (main.ts) needs of a planet: the meadow (world.ts) and
 * the terraces (terraces/world.ts) both are one. A visit swaps which one
 * main.ts updates and draws; each keeps its own scene, camera and build queue.
 */
export interface PlanetWorld {
  readonly kind: PlanetKind;
  readonly scene: Scene;
  readonly rig: CameraRig;
  readonly growth: GrowthState;
  readonly queue: BuildQueue;
  readonly surface: { readonly selection: ChunkSelection };
  /** Whether the last update drew the near field (blades, flowers, rice). */
  readonly nearFieldDrawn: boolean;
  /** Instances of the near field in view (perf stats): blades, and flowers (or the rice). */
  readonly nearInstances: { readonly grass: number; readonly flowers: number };
  readonly needsDefaultPose: boolean;
  markPosed(): void;
  defaultPose(): void;
  cameraPreset(name: CameraPreset, immediate?: boolean): void;
  applyTier(tier: Tier): void;
  onParams(changed: ReadonlySet<ParamPath>): void;
  update(clock: FrameClock, aspect: number, viewportHeight: number): void;
  /** Close fade bands, finish queued work and snap the camera: the next frame is a pure function of state. */
  settle(): void;
  /** A grade of its own (the frame's final grade, render/post.ts), in place of the style's contrast, brightness, tone curve and bloom. */
  readonly grade?: { readonly curve: boolean; readonly bloom: boolean; readonly contrast: number; readonly brightness: number };
  /** Work done off the page's thread (the terraces' build in its worker): resolved once it is in place. */
  whenBuilt?(): Promise<void>;
  pick(ndcX: number, ndcY: number): Pick | null;
  ripple(dir: Vector3, time: number): void;
  gust(dir: Vector3, time: number): void;
  effectiveTriangles(submitted: number): number;
}
