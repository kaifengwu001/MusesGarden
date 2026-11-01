const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SOCIAL = {
  /** Units for the encounter rate (per hour while both are beyond). The rate itself is sociability · sociability · similarity. */
  encountersPerHour: 8,
  familiarityBase: 1,
  familiaritySpan: 3,
  befriendBase: 0.5,

  /** Share of pleasantness that comes from both Muses' warmth (mean sociability), whatever their interests. */
  pleasantWarmth: 0.3,
  pleasantSimilarity: 0.6,
  pleasantStretch: 0.4,
  /** A hangout is unpleasant when it falls below this share of the pair's own average so far. */
  unpleasantVsAverage: 0.7,
  /** The pair needs this many hangouts before a drop can count against them. */
  unpleasantAfterHangouts: 3,
  /** A friendship ends only after this many unpleasant hangouts in a row; before that the pair just grows distant. */
  endingStreak: 6,
  /** Each unpleasant hangout moves distance this share of the way to distanceMax... */
  distantStep: 0.4,
  /** ...and each pleasant one keeps this share of it, so coming back takes longer than drifting. */
  closerKeep: 0.8,
  /** Below 1, so a distant pair still meets now and then. */
  distanceMax: 0.9,

  budgetMsAtFullSociability: 3 * HOUR,
  closenessTemperature: 0.2,
  goUsually: 0.5,
  goAfterBeingGuest: 0.3,
  visitMedianMs: 50 * MINUTE,
  visitSigma: 0.4,
  /** Two friends' first visit, uncut by the day's social time. */
  firstMeetingMs: 45 * MINUTE,

  inviteRapportBase: 1,
  inviteRapportSpan: 2,
  inviteCooldownMs: 14 * DAY,
  /** The guest's visit view stays readable this long after they use the invitation, so a reload still works. */
  visitViewMs: 2 * HOUR,

  weightFloor: 0.2,
  weightAffinity: 0.5,
  weightSalience: 0.3,
  salienceTauMs: 3 * DAY,

  hangoutZoom: 0.8,
  beyondZoom: 0.05,
} as const;
