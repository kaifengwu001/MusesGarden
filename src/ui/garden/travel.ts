import { gardenMuse, ReactionError } from '../../garden/source';
import type { Invitation, MuseStatus } from '../../garden/types';
import { isPlanetId } from '../../muse/planets';
import { visitable, visitUrl } from '../../visit/params';

// Travel: a ticket from the post takes you, with Muse, to your friend's own planet, where the visit runtime
// (src/visit/) shows it. Boarding asks the backend first: it may turn the ticket down (used up, withdrawn, not yours)
// or not answer, and then you stay home and are told why. A trip under way can be gone back to while it lasts.

/** The garden's backend and its Muse, as this page's URL names them (`?garden=…/api/muses/<id>`); null without one. */
function gardenOf(search: string): { readonly garden: string; readonly as: string } | null {
  const garden = new URLSearchParams(search).get('garden');
  const as = garden ? gardenMuse(garden) : null;
  return garden && as ? { garden, as } : null;
}

/** Why a ticket can't be used at all yet, before the backend is asked: its host's planet isn't open for visits. Null when it is. */
export function closed(invitation: Invitation): string | null {
  return isPlanetId(invitation.world) && !visitable(invitation.world) ? `${invitation.fromName}’s planet isn’t open for visits yet.` : null;
}

/**
 * The page a ticket takes you to: its host's planet, on this visit. Null when this garden can't travel: the
 * placeholder garden (no backend to board with), or a ticket that names no planet open to visits.
 */
export function boardingUrl(ticketId: string, invitation: Invitation, search: string): string | null {
  const at = gardenOf(search);
  if (!at || !visitable(invitation.world)) return null;
  return visitUrl(invitation.world, { invitation: ticketId, as: at.as, garden: at.garden });
}

/** The way back to a trip under way: its visit's page. */
export function tripUrl(trip: NonNullable<MuseStatus['trip']>, search: string): string | null {
  const at = gardenOf(search);
  if (!at || !visitable(trip.planet)) return null;
  return visitUrl(trip.planet, { invitation: trip.invitation, as: at.as, garden: at.garden });
}

/** Why a ticket didn't take you anywhere, in a line. */
export function refusal(error: unknown): string {
  const status = error instanceof ReactionError ? error.status : 0;
  if (status === 409) return 'This ticket has been used already, or taken back.';
  if (status === 403) return 'This ticket is someone else’s.';
  if (status === 404) return 'This ticket isn’t in the post any more.';
  return 'The ticket couldn’t be used just now. Try again in a moment.';
}
