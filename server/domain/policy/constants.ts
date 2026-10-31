// Every tunable number in the Muse's life, in one table. Each rule multiplies these by the Muse's own traits.
// Rationale: docs/muse-agent.md ("A life is one unbroken timeline", "What the owner sees and does").
import { DAY_MS, HOUR_MS, MINUTE_MS } from '../time';

// ── Interests ──────────────────────────────────────────────────────────────
/** Salience decays as exp(−Δt / τ). */
export const SALIENCE_TAU_MS = 3 * DAY_MS;
/** Salience never exceeds this: the pick and the travel weight read it as a pull in [0, 1]. */
export const SALIENCE_MAX = 1;
/** Salience added to each topic of a find Muse kept. */
export const BOOST_KEPT = 0.3;
/** Salience added to each topic of a page Muse looked at and passed over. */
export const BOOST_LOOKED = 0.05;
/** Salience for a MEMORY.md or SOUL.md mention, times w_owner. */
export const BOOST_OWNER = 0.5;
/** Salience added to each topic of a gift Muse received. */
export const BOOST_GIFT = 0.2;
/** w_owner = W_OWNER_BASE / (1 + W_OWNER_DECAY · garden soul version): the owner's pull fades as Muse reflects. */
export const W_OWNER_BASE = 0.5;
export const W_OWNER_DECAY = 0.1;
/** Affinity stays in [0, 1]. */
export const AFFINITY_MIN = 0;
export const AFFINITY_MAX = 1;

// ── Stages (reflection gates) ──────────────────────────────────────────────
/** Distinct sources an interest needs to be `emerging`. */
export const EMERGING_SOURCES = 2;
/** Distinct sources an interest needs to be `established`... */
export const ESTABLISHED_SOURCES = 4;
/** ...found over at least this many owner-local days. */
export const ESTABLISHED_DAYS = 2;
/** An interest may fade after this long without being pursued. */
export const FADING_IDLE_MS = 14 * DAY_MS;

// ── Reflection ─────────────────────────────────────────────────────────────
/** Each Δaffinity is clamped to ±this. */
export const MAX_AFFINITY_DELTA = 0.2;
/** Reflect at the start of a rest when this long has passed since the last reflection... */
export const REFLECTION_DUE_MS = 3 * DAY_MS;
/** ...or when this many new experiences have piled up. */
export const REFLECTION_DUE_EXPERIENCES = 8;

// ── Next activity ──────────────────────────────────────────────────────────
/** travel = TRAVEL_BASE + curiosity + top salience. */
export const TRAVEL_BASE = 1;
/** rest = (REST_BASE + REST_PER_WORK · recentWork) × [rest today < REST_CAP_MS]. */
export const REST_BASE = 0.3;
export const REST_PER_WORK = 1.5;
/** recentWork = min(1, work in the last RECENT_WORK_WINDOW_MS ÷ RECENT_WORK_FULL_MS). */
export const RECENT_WORK_WINDOW_MS = 12 * HOUR_MS;
export const RECENT_WORK_FULL_MS = 6 * HOUR_MS;
/** Rest per owner-day never exceeds this. */
export const REST_CAP_MS = 4 * HOUR_MS;
/** visit = VISIT_SCALE · sociability × (social time left ÷ budget) × [a friend is free]. */
export const VISIT_SCALE = 2;
/** Daily social budget = SOCIAL_BUDGET_MS × sociability. */
export const SOCIAL_BUDGET_MS = 3 * HOUR_MS;

// ── Durations (lognormal: median, log-space sigma) ─────────────────────────
export const REST_MEDIAN_MS = 40 * MINUTE_MS;
/** Wide enough that about one rest in six runs past 90 min and shows as sleep. */
export const REST_SIGMA = 0.8;
export const HOP_MEDIAN_MS = 40 * MINUTE_MS;
export const HOP_SIGMA = 0.35;
export const BEYOND_MEDIAN_MS = 90 * MINUTE_MS;
export const BEYOND_SIGMA = 0.4;
/** The typical hangout; the photo cap reserves one slot per hangout this long left in today's budget. */
export const VISIT_MEDIAN_MS = 50 * MINUTE_MS;
/** A rest at least this long shows as sleep. */
export const SLEEP_MIN_MS = 90 * MINUTE_MS;

// ── Starting a trip ────────────────────────────────────────────────────────
/** P(beyond) = BEYOND_SCALE · curiosity · sociability. */
export const BEYOND_SCALE = 0.25;
/** P(new area) = min(1, NOVELTY_SCALE · novelty + UNLOCK_PRESSURE_PER_DAY · days since the last unlock). */
// Calibrated per trip against the 3-week sim (about 15 trips a free day), aiming at roughly one new area a day.
export const NOVELTY_SCALE = 0.08;
export const UNLOCK_PRESSURE_PER_DAY = 0.03;
/** Within a new-area trip, ε = SERENDIPITY_SCALE · curiosity picks a far region instead. */
export const SERENDIPITY_SCALE = 0.1;
/** A new area opens in one of this many nearest fogged regions. */
export const NEAR_CHOICES = 3;
/** A serendipity region lies at least this far (radians) from home. */
export const FAR_MIN_ANGLE = Math.PI / 2;

// ── Topic pick for a revisit: score, then softmax(score / τ) ───────────────
export const PICK_AFFINITY = 0.35;
export const PICK_SALIENCE = 0.3;
export const PICK_QUESTION = 0.15;
/** Times w_owner, when MEMORY.md or SOUL.md mentioned the topic within PICK_OWNER_RECENT_MS. */
export const PICK_OWNER = 0.2;
export const PICK_OWNER_RECENT_MS = 7 * DAY_MS;
/** fatigue = exp(−time since last pursued / PICK_FATIGUE_TAU_MS). */
export const PICK_FATIGUE = 0.25;
export const PICK_FATIGUE_TAU_MS = 12 * HOUR_MS;
export const PICK_TAU = 0.15;

// ── Hops ───────────────────────────────────────────────────────────────────
/** θ: Muse keeps a page only with a score at least this. */
export const KEEP_THRESHOLD = 0.75;
/** At most this many kept per hop. */
export const KEEP_MAX = 2;
/** A passed-over page this good joins the frontier, where new areas come from. */
export const FRONTIER_MIN_SCORE = 0.5;
/** The frontier keeps only the newest this many topics. */
export const FRONTIER_MAX = 40;
/** A trip's hops walk this far (in region widths) from one spot to the next. */
export const HOP_STEP = 0.12;
/** Hop spots keep this far (in region widths) from the region's edge. */
export const HOP_MARGIN = 0.06;
/** Tries to find dry ground before settling for the driest spot. */
export const HOP_WATER_TRIES = 12;
/** Planet radius (m) at which hop spots are checked for water. */
export const PLACEMENT_RADIUS = 400;
/** A spot is dry when it is at least this far (m) from the shore. */
export const DRY_MARGIN_M = 1;

// ── Photos ─────────────────────────────────────────────────────────────────
/** Photos per hour while doing each activity, times whimsy. Hangout photos come from the social policy. */
export const PHOTO_RATE_PER_HOUR = { beyond: 0.4, travel: 0.3, rest: 0.1, work: 0.02, visit: 0 } as const;
/** At most this many photos per owner-day, guaranteed social photos included. */
export const PHOTO_DAILY_CAP = 5;

// ── Baskets ────────────────────────────────────────────────────────────────
/** A basket is due with this many finds waiting... */
export const BASKET_MIN_ITEMS = 3;
/** ...or with one waiting and this long since the last basket. */
export const BASKET_STALE_MS = 3 * DAY_MS;
/** A basket holds at most this many finds, best by keep score. */
export const BASKET_MAX_ITEMS = 7;

// ── Shelf ──────────────────────────────────────────────────────────────────
export const SHELF_SIZE = 10;
/** fondness = SHELF_KEEP · keep score + SHELF_PULL · topic pull + SHELF_GIFT · closeness to the giver. */
export const SHELF_KEEP = 0.5;
export const SHELF_PULL = 0.5;
export const SHELF_GIFT = 0.1;

/** A Wikipedia category becomes an interest once this many of Muse's finds share it: a theme, not a label. */
export const CATEGORY_THEME_MIN_FINDS = 3;
