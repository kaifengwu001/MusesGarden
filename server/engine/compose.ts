// The composition root: the one place that picks concrete stores, sources and minds and wires the domain lanes
// into the engine. Everything else depends only on the contract.
import type { CastMember, Instant, Mind, MuseId, MuseState, Source, Store } from '../../src/muse/contract';
import { HeuristicMind } from '../adapters/minds/heuristic';
import { MetaMind } from '../adapters/minds/meta';
import { loadCorpus } from '../adapters/sources/corpus';
import { loadMediaRecording, MediaSource, type MediaRecording } from '../adapters/sources/media';
import { openMemoryStore } from '../adapters/store/memory';
import { openSqliteStore } from '../adapters/store/sqlite';
import { REGIONS, regionCentre } from '../domain/atlas';
import { salienceAt } from '../domain/interests';
import { renderJournal } from '../domain/journal';
import { metrics } from '../domain/metrics';
import { lifePolicy } from '../domain/policy/index';
import { drawFor } from '../domain/rng';
import { shelf } from '../domain/shelf';
import { socialPolicy } from '../domain/social/policy';
import { reduceSocial } from '../domain/social/state';
import { renderSoulSection } from '../domain/soul';
import { emptyState, reduceCore } from '../domain/state';
import { Engine, type EngineDeps } from './engine';
import { Commands, Views, type ViewHelpers } from './views';

export interface GardenOptions {
  /** A SQLite file, or null for memory only. */
  readonly db: string | null;
  /** 'meta' gives the hero MetaMind (falling back to HeuristicMind without a key); everyone else stays heuristic. */
  readonly mind: 'heuristic' | 'meta';
  readonly hero: MuseId | null;
  readonly start: Instant;
  readonly clock: 'live' | 'fast-forward';
  readonly roles?: ReadonlyMap<MuseId, CastMember['role']>;
  /** The run's seed for every draw (0, the default, is every earlier run). */
  readonly seed?: number;
}

export interface Garden {
  readonly engine: Engine;
  readonly views: Views;
  readonly commands: Commands;
  readonly store: Store;
  readonly heroMind: Mind;
  /** The recorded reels, posts, articles and videos every find comes from. */
  readonly recording: MediaRecording;
}

/** Explored area drives the planet's growth slider: home alone is small, about forty regions is full size. */
export function growth(s: MuseState): number {
  return Math.min(1, 0.05 + (0.95 * Math.max(0, s.regions.size - 1)) / 40);
}

export const viewHelpers: ViewHelpers = {
  regions: REGIONS,
  regionCenter: regionCentre,
  growth,
  salienceAt,
  shelf: (s, now) => shelf(s, now),
  soulSection: renderSoulSection,
  journal: renderJournal,
  metrics,
};

export function buildGarden(opts: GardenOptions): Garden {
  const store = opts.db ? openSqliteStore(opts.db) : openMemoryStore();
  const recording = loadMediaRecording();
  const source: Source = new MediaSource(recording, loadCorpus());
  const heuristic = new HeuristicMind();
  const heroMind: Mind = opts.mind === 'meta' ? new MetaMind({ cache: store.llmCache, fallback: heuristic }) : heuristic;
  const deps: EngineDeps = {
    store,
    life: lifePolicy,
    social: socialPolicy,
    reduceCore,
    reduceSocial,
    emptyState: (seed) => emptyState(seed),
    drawFor: (id, n) => drawFor(id, n, opts.seed ?? 0),
    salienceAt,
    source,
    mindFor: (id) => (id === opts.hero ? heroMind : heuristic),
  };
  const engine = new Engine(deps, opts.start);
  const views = new Views(engine, socialPolicy, viewHelpers, opts.roles ?? new Map());
  const commands = new Commands(engine, opts.clock);
  return { engine, views, commands, store, heroMind, recording };
}
