const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const SOCIAL = {
  familiarityBase: 1,
  familiaritySpan: 3,
  befriendBase: 0.5,

  pleasantSimilarity: 0.6,
  pleasantStretch: 0.4,
  unpleasantBelow: 0.3,
  streakBase: 2,
  streakRapportStep: 2,

  budgetMsAtFullSociability: 3 * HOUR,
  closenessTemperature: 0.2,
  goUsually: 0.5,
  goAfterBeingGuest: 0.3,
  visitMedianMs: 50 * MINUTE,
  visitSigma: 0.4,

  inviteRapportBase: 1,
  inviteRapportSpan: 2,
  inviteCooldownMs: 14 * DAY,
  windowMs: 2 * HOUR,
  windowLeadMs: 2 * HOUR,
  windowSearchMs: 3 * DAY,
  windowStepMs: 15 * MINUTE,
  windowDayStart: 9 * 60,
  windowDayEnd: 21 * 60,
  hostAnswerBeforeStartMs: HOUR,

  weightFloor: 0.2,
  weightAffinity: 0.5,
  weightSalience: 0.3,
  salienceTauMs: 3 * DAY,

  hangoutZoom: 0.8,
  beyondZoom: 0.05,
} as const;
