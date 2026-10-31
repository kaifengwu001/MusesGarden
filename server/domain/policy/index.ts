// The life policy the engine calls: pure, seeded, and a function of each Muse's own temperament.
import type { LifePolicy } from '../../../src/muse/contract';
import { besidePlace, hopPlace } from '../atlas';
import { privacyFilterIn } from '../privacy';
import { experiences, reflectionDue, validateReflection } from '../reflection';
import { parseSoul } from '../soul';
import { basket, nextBasketCheck } from './basket';
import { beyondUntil, next, restUntil } from './life';
import { photosDuring } from './photo';
import { continueTrip, hopMs, keep, serendipityRegion, startTrip } from './travel';

export const lifePolicy: LifePolicy = {
  next,
  restUntil,
  beyondUntil,
  startTrip,
  serendipityRegion,
  hopMs,
  hopPlace: (s, region, k, draw) => hopPlace(s.seed.worldSeed, region, k, draw),
  findPlace: (s, hop, i) => besidePlace(s.seed.worldSeed, hop, i),
  keep,
  continueTrip,
  photosDuring,
  basket,
  nextBasketCheck,
  reflectionDue,
  experiences,
  validateReflection,
  privacyFilter: privacyFilterIn,
  parseSoul,
};
