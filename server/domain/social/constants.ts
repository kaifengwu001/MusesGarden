// Every social number in one table, so it can be tuned and shown. Each rule still takes the Muses' own
// traits and interest overlap as input; these are the shapes of those rules, not shared outcomes.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SOCIAL = {
  /** F_i = base + span · (1 − sociability_i): summed encounter pleasantness before Muse i will decide. */
  familiarityBase: 1,
  familiaritySpan: 3,
  /** P_i = similarity · (base + (1 − base) · sociability_i). */
  befriendBase: 0.5,

  /** p = similarity weight · similarity + stretch weight · 4 · overlap · (1 − overlap). */
  pleasantSimilarity: 0.6,
  pleasantStretch: 0.4,
  /** A hangout below this is unpleasant. */
  unpleasantBelow: 0.3,
  /** k = base + floor(rapport / step) unpleasant hangouts in a row end a friendship. */
  streakBase: 2,
  streakRapportStep: 2,

  /** B_i = this · sociability_i of hangout time per owner-day. */
  budgetMsAtFullSociability: 3 * HOUR,
  /** P(friend j) ∝ exp(closeness_j / temperature). */
  closenessTemperature: 0.2,
  /** P(self goes to the friend's planet): usually, and after being the guest last time. */
  goUsually: 0.5,
  goAfterBeingGuest: 0.3,
  visitMedianMs: 50 * MINUTE,
  visitSigma: 0.4,

  /** A host proposes once rapport since the last invitation ≥ base + span · (1 − sociability_host). */
  inviteRapportBase: 1,
  inviteRapportSpan: 2,
  inviteCooldownMs: 14 * DAY,
  windowMs: 2 * HOUR,
  /** The window is the earliest slot starting at least `lead` from now and ending within `search`. */
  windowLeadMs: 2 * HOUR,
  windowSearchMs: 3 * DAY,
  windowStepMs: 15 * MINUTE,
  /** Local minutes since midnight, for both owners. */
  windowDayStart: 9 * 60,
  windowDayEnd: 21 * 60,
  hostAnswerBeforeStartMs: HOUR,

  /** PublicProfile weight = floor + affinity · a + current salience · b, clamped to [0, 1]. */
  weightFloor: 0.2,
  weightAffinity: 0.5,
  weightSalience: 0.3,
  salienceTauMs: 3 * DAY,

  /** Camera zoom: 0 is far out over the planet, about 0.83 is a standing view. */
  hangoutZoom: 0.8,
  beyondZoom: 0.05,
} as const;
