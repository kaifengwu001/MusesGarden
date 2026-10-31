import type { SocialPolicy } from '../../../src/muse/contract';
import { encounter, encounterRate } from './encounters';
import { chooseVisit, hangout } from './hangouts';
import { canVisit, invitationStep, invitationTimers } from './invitations';
import { photoSlotsLeft } from './photos';
import { publicProfile } from './profile';
import { ownerLink } from './relationships';

export const socialPolicy: SocialPolicy = {
  chooseVisit,
  encounterRate,
  encounter,
  hangout,
  invitationStep,
  invitationTimers,
  canVisit,
  photoSlotsLeft,
  publicProfile,
  ownerLink,
};
