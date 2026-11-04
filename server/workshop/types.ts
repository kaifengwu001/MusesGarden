// The workshop's seam: Muse's briefs become jobs that work in rounds (server/workshop). The runner (lane D) keeps
// the jobs; each kind's pipeline (body, planet, home) says what one step does and how Muse's answer moves it on.
import type { AgentResult, Instant, MuseId, MuseLook, PlanetId } from '../../src/muse/contract';
import type { WorkshopClients } from './clients';

export type JobKind = 'planet' | 'body' | 'home';
/** 32 hex characters: unguessable, since /w/<job>/<file> needs no key. */
export type JobId = string;

/** What Muse asked for, in its own words. */
export interface Brief {
  readonly kind: JobKind;
  /** How it should feel, or who Muse is in its body. */
  readonly text: string;
  readonly must?: readonly string[];
  readonly never?: readonly string[];
  /** Links to pictures Muse found that feel right. They only guide; nothing is copied. */
  readonly references?: readonly string[];
  /** The body's starting point: Muse's app avatar (avatar.get). `image` is a data: URL (base64), at most 2 MB. */
  readonly avatar?: { readonly image?: string; readonly description?: string };
  /** The body: what it would wear and carry. The home: the things it wants in it. */
  readonly things?: readonly string[];
}

/** One picture in a round, served at /w/<job>/<file>. */
export interface PacketPicture {
  readonly id: string;
  readonly path: string;
  readonly caption: string;
}

/** One round waiting for Muse: what it is, the pictures, and what Muse is asked to do. */
export interface Packet {
  readonly job: JobId;
  readonly kind: JobKind;
  readonly round: number;
  readonly stage: string;
  /** pick: choose between min and max of the pictures; approve: approve, or send up to 3 notes. */
  readonly ask: 'pick' | 'approve';
  /** Plain words: what this round is and how to answer it. */
  readonly text: string;
  readonly pictures: readonly PacketPicture[];
  readonly pick?: { readonly min: number; readonly max: number };
  /** A visual contract to approve or edit, as text. */
  readonly contract?: string;
  readonly checklist?: readonly { readonly item: string; readonly ok: boolean; readonly note: string }[];
}

/** Muse's answer to a packet. */
export interface Verdict {
  readonly approve?: boolean;
  /** The planet's name, with the approval of a planet. */
  readonly name?: string;
  /** Picture ids, for a pick. */
  readonly picks?: readonly string[];
  /** Up to 3. `at` is a spot on a 0–1000 grid of `picture` (from Muse's visual_grounding). */
  readonly notes?: readonly { readonly text: string; readonly picture?: string; readonly at?: readonly [number, number] }[];
}

export type JobState = 'working' | 'waiting' | 'done' | 'failed';

export interface JobRecord {
  readonly id: JobId;
  readonly museId: MuseId;
  readonly kind: JobKind;
  readonly brief: Brief;
  readonly state: JobState;
  readonly stage: string;
  /** Rounds shown to Muse so far (at most 3 drafts per job). */
  readonly round: number;
  /** The pipeline's own working data, saved after every step (JSON). */
  readonly data: Readonly<Record<string, unknown>>;
  readonly packet: Packet | null;
  /** Plain words: what's happening now, or why it failed. */
  readonly message: string;
  readonly createdAt: Instant;
  readonly updatedAt: Instant;
}

/** What Muse sees of a job (workshop_round). */
export interface JobView {
  readonly id: JobId;
  readonly kind: JobKind;
  readonly state: JobState;
  readonly stage: string;
  readonly round: number;
  readonly packet: Packet | null;
  /** When to look again while it's working (also rung on the doorbell when ready). */
  readonly nextRoundAt: Instant | null;
  readonly message: string;
}

export interface Workshop {
  start(museId: MuseId, brief: Brief): Promise<AgentResult<JobView>>;
  jobs(museId: MuseId): readonly JobView[];
  job(museId: MuseId, id: JobId): JobView | null;
  review(museId: MuseId, id: JobId, verdict: Verdict): Promise<AgentResult<JobView>>;
  /** Another view of what's on show ("from my porch at dusk"); answers with the new picture's packet. */
  view(museId: MuseId, id: JobId, ask: string): Promise<AgentResult<JobView>>;
  /** Rounds waiting for Muse: the doorbell's count. */
  pending(museId: MuseId): number;
}

/** What a finished job hands the engine (applyLook / applyPlanet). */
export interface JobResult {
  readonly look?: MuseLook;
  readonly planet?: { readonly id: PlanetId; readonly worldSeed: number; readonly name: string };
}

export type StepOutcome =
  /** Go straight on to the next step. */
  | { readonly kind: 'continue'; readonly stage: string; readonly data: Readonly<Record<string, unknown>>; readonly message?: string }
  /** A round is ready: wait for Muse's verdict. */
  | { readonly kind: 'wait'; readonly stage: string; readonly data: Readonly<Record<string, unknown>>; readonly packet: Omit<Packet, 'job' | 'kind' | 'round'> }
  | { readonly kind: 'done'; readonly data: Readonly<Record<string, unknown>>; readonly result: JobResult; readonly message: string }
  | { readonly kind: 'failed'; readonly message: string };

export interface StageIO {
  /** Absolute: .muse/workshop/<job>/. Write every file a packet shows here. */
  readonly dir: string;
  /** '/w/<job>/<file>' for a file in `dir`. */
  readonly url: (file: string) => string;
  readonly clients: WorkshopClients;
  readonly log: (line: string) => void;
  readonly signal: AbortSignal;
  /** The repository's root. */
  readonly repo: string;
  /** The page's dev server, for headless renders (npm run dev), e.g. http://localhost:5173. */
  readonly devServer: string;
}

/** One kind of job: lanes E (body), G (planet) and H (home) each export one from server/workshop/<kind>/index.ts. */
export interface Pipeline {
  readonly kind: JobKind;
  readonly firstStage: string;
  /** Runs the step for job.stage from job.data. Must be safe to run again after a crash (check for files already made). */
  step(job: JobRecord, io: StageIO): Promise<StepOutcome>;
  /** Muse answered the packet at job.stage: where to go next and with what data, or a plain refusal (422). */
  answer(
    job: JobRecord,
    verdict: Verdict,
  ): { readonly ok: true; readonly stage: string; readonly data: Readonly<Record<string, unknown>> } | { readonly ok: false; readonly error: string };
  /** Another view of what's on show, if this kind can render one. */
  view?(job: JobRecord, ask: string, io: StageIO): Promise<{ readonly ok: true; readonly picture: PacketPicture } | { readonly ok: false; readonly error: string }>;
  /** About how long the step for `stage` takes (ms), for next_round_at. */
  estimateMs(stage: string): number;
}
