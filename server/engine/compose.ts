// The composition root: the one place that picks concrete stores, sources and minds and wires the domain lanes
// into the engine. Everything else depends only on the contract.
import type { Instant, Intake, MemberInfo, Mind, MuseId, MuseState, Source, Store } from '../../src/muse/contract';
import { isGeneratedPlanet } from '../../src/muse/planets';
import { FIRST_PLANET } from '../../src/planet/firstPlanet';
import { AgentMind } from '../adapters/minds/agent';
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
import { parseSoul, renderSoulSection } from '../domain/soul';
import { planetStills } from '../fixtures/planetStills';
import { emptyState, reduceCore } from '../domain/state';
import { localDay } from '../domain/time';
import { AgentApi, refuseEveryLink } from './agent';
import { Engine, type EngineDeps } from './engine';
import { Commands, Views, worldSeedOf, type ViewHelpers } from './views';

export interface GardenOptions {
  /** A SQLite file, or null for memory only. */
  readonly db: string | null;
  /** 'meta' gives the hero MetaMind (falling back to HeuristicMind without a key); everyone else stays heuristic. */
  readonly mind: 'heuristic' | 'meta';
  /** With 'meta', what the hero's model does: write its postcards only (the default), or its whole mind, a model call for every hop it judges. */
  readonly modelFor?: 'postcards' | 'all';
  readonly hero: MuseId | null;
  readonly start: Instant;
  readonly clock: 'live' | 'fast-forward';
  /** Each cast member's role, planet and look, from cast.json; a Muse missing here is a stranger on the meadow. */
  readonly members?: ReadonlyMap<MuseId, MemberInfo>;
  /** The run's seed for every draw (0, the default, is every earlier run). */
  readonly seed?: number;
  /** What opens a real Muse's kept links (server/agent/intake.ts); without it, every link is refused. */
  readonly intake?: Intake;
}

export interface Garden {
  readonly engine: Engine;
  readonly views: Views;
  readonly commands: Commands;
  readonly store: Store;
  readonly heroMind: Mind;
  /** The recorded reels, posts, articles and videos every find comes from. */
  readonly recording: MediaRecording;
  /** A real Muse's commands and queries (AgentCommands and AgentQueries), for its connector (server/agent). */
  readonly agent: AgentApi;
}

/**
 * Explored area drives the planet's growth slider: home alone is small, about forty regions is full size. A Muse on
 * the first planet (Momo, on the meadow) has explored the meadow's tuned size already, and grows from there; a planet
 * the workshop built (planet.changed) starts small, whatever its seed.
 */
export function growth(s: MuseState): number {
  const built = s.planet !== undefined && isGeneratedPlanet(s.planet.id);
  const start = !built && worldSeedOf(s) === FIRST_PLANET.seed ? FIRST_PLANET.growth : 0.05;
  return Math.min(1, start + (0.95 * Math.max(0, s.regions.size - 1)) / 40);
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
  localDay,
  soulBody: (soulMd) => parseSoul(soulMd).body,
  planetStills,
};

/** A mind that writes its postcards with `model` and thinks everything else with `rest`. */
function postcardsBy(model: Mind, rest: Mind): Mind {
  return {
    judge: (ctx, candidates) => rest.judge(ctx, candidates),
    proposeQuestion: (ctx, topic, recent) => rest.proposeQuestion(ctx, topic, recent),
    reflect: (ctx, experiences) => rest.reflect(ctx, experiences),
    extractInterests: (text, from) => rest.extractInterests(text, from),
    estimateTemperament: (soul) => rest.estimateTemperament(soul),
    writePostcard: (ctx, ask) => model.writePostcard(ctx, ask),
  };
}

export function buildGarden(opts: GardenOptions): Garden {
  const store = opts.db ? openSqliteStore(opts.db) : openMemoryStore();
  const recording = loadMediaRecording();
  const media = new MediaSource(recording, loadCorpus());
  const source: Source = media;
  const heuristic = new HeuristicMind();
  const model = opts.mind === 'meta' ? new MetaMind({ cache: store.llmCache, fallback: heuristic }) : null;
  const heroMind: Mind = !model ? heuristic : opts.modelFor === 'all' ? model : postcardsBy(model, heuristic);
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
    // A real Muse (agent.joined) gets this mind whoever it is: its choices and words come through its connector.
    agentMind: new AgentMind(),
  };
  const engine = new Engine(deps, opts.start);
  const views = new Views(engine, socialPolicy, { ...viewHelpers, grownHere: (topics, limit, exclude) => media.recordedFor(topics, limit, exclude) }, opts.members ?? new Map());
  const commands = new Commands(engine, opts.clock);
  const agent = new AgentApi(engine, views, socialPolicy, { intake: opts.intake ?? refuseEveryLink, salienceAt });
  return { engine, views, commands, store, heroMind, recording, agent };
}
