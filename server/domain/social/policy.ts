import type { SocialPolicy } from '../../../src/muse/contract';
import { encounter, encounterRate } from './encounters';
import { chooseVisit, hangout } from './hangouts';
import { canVisit, invitationStep, invitationTimers } from './invitations';
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
  publicProfile,
  ownerLink,
};
