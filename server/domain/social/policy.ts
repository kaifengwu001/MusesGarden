import type { SocialPolicy } from '../../../src/muse/contract';
import { encounter, encounterRate } from './encounters';
import { chooseVisit, hangout, visitOffer } from './hangouts';
import { invitationStep, visitUntil } from './invitations';
import { photoSlotsLeft } from './photos';
import { publicProfile } from './profile';
import { inReach } from './reach';
import { ownerLink } from './relationships';

export const socialPolicy: SocialPolicy = {
  visitOffer,
  chooseVisit,
  encounterRate,
  encounter,
  hangout,
  invitationStep,
  visitUntil,
  photoSlotsLeft,
  publicProfile,
  inReach,
  ownerLink,
};
