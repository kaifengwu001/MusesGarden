import type { SocialPolicy } from '../../../src/muse/contract';
import { encounter, encounterRate } from './encounters';
import { chooseVisit, hangout } from './hangouts';
import { invitationStep, visitUntil } from './invitations';
import { photoSlotsLeft } from './photos';
import { publicProfile } from './profile';
import { ownerLink } from './relationships';

export const socialPolicy: SocialPolicy = {
  chooseVisit,
  encounterRate,
  encounter,
  hangout,
  invitationStep,
  visitUntil,
  photoSlotsLeft,
  publicProfile,
  ownerLink,
};
