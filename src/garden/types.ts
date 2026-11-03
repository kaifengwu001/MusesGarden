// What the garden shows, as the backend sends it (source.ts). Everything on
// the planet is something Muse chose to keep or gave you in a basket: a find
// grows as a small bed of flowers, its species the find's topic, and the
// day's finds grow side by side as that basket's patch. Postcards are
// Muse's photographs (invitations among them); interests and friends are
// Muse's, and only what Muse shares leaves the planet. No human names: only
// Muses' names appear anywhere in the garden.

/** What kind of thing Muse found online. */
export type MediaKind = 'reel' | 'post' | 'article' | 'video';

/** A find as it lives online: the card is drawn from these fields, never from an embed. */
export interface Media {
  kind: MediaKind;
  /** Where it lives online; the card's link. */
  url: string;
  /** The site or app: 'Instagram', 'Dezeen', 'YouTube', … */
  source: string;
  /** A public account's handle ('@studio.lumen') or an article's byline. */
  author?: string;
  /** An article's headline or a video's title. */
  title?: string;
  /** A caption, or an article's first lines. */
  text?: string;
  /** The picture: a thumbnail URL (or a data: URL). */
  image?: string;
  /** The picture's width over its height (a reel 9/16, a post 4/5 or 1, an article 16/9). */
  aspect?: number;
  /** Length of a reel or a video (s). */
  duration?: number;
  /** Minutes to read an article. */
  minutes?: number;
  /** When it was published online (ISO date). */
  published?: string;
}

export interface Find {
  id: string;
  /** The basket it came home in. */
  basket: string;
  /** The interest it belongs to: which flower it grows as. */
  topic: string;
  media: Media;
  /** Muse's own word about it, a line at most (optional). */
  note?: string;
  /** Where on the planet it grows (a unit direction), if the backend placed it; otherwise placement.ts lays it out. */
  place?: readonly [number, number, number];
  /** Whether other Muses may see it (the card's Public/Private switch); a private find never leaves the planet. */
  shared: boolean;
  /** Whether you liked it, when the backend keeps likes; without it this browser remembers them. */
  liked?: boolean;
}

/** One day's finds, handed over together. */
export interface Basket {
  id: string;
  /** The day Muse gave it (ISO date). */
  day: string;
  /** Its finds, in the order Muse would show them. */
  finds: readonly string[];
  /** Muse's name for the day, if it gave one. */
  title?: string;
}

export interface Invitation {
  /** The Muse who invites you: its id, its name, and its coat as a CSS colour (its ticket is printed in it). */
  from: string;
  fromName: string;
  coat: string;
  /** Its world: an id the travel step resolves, and the world's name. */
  world: string;
  worldName: string;
  /** A line about the world. */
  blurb: string;
  /** Good for one visit: set once it is used. */
  used?: boolean;
  /** The last day it can be used (ISO date), if it expires. */
  until?: string;
}

/** A photo Muse sent home; an invitation is a postcard that carries one. */
export interface Postcard {
  id: string;
  /** The day it arrived (ISO date). */
  day: string;
  image: string;
  /** Where it was taken, as Muse would put it. */
  place: string;
  /** A friend Muse in the photo, if any. */
  with?: string;
  invitation?: Invitation;
  /** Whether you liked it, when the backend keeps likes; without it this browser remembers them. */
  liked?: boolean;
  /** Whether you starred it, kept for you alone, when the backend keeps favorites; without it this browser remembers them. */
  favorite?: boolean;
  /** What Muse wrote or drew on the back. Without it (an invitation, an older photo) the back shows the place and day. */
  back?: PostcardBack;
  /** How the photo is shown when its still has come round before; without it, as the still is. */
  look?: PhotoLook;
}

/** A still shown again: mirrored or not, cropped in (zoom 1 is the whole still) on the point (x, y) in 0..1, and toned. */
export interface PhotoLook {
  flip: boolean;
  zoom: number;
  x: number;
  y: number;
  tone: 'none' | 'warm' | 'cool' | 'dusk' | 'mist' | 'bright';
}

/** The drawings Muse can put on a postcard's back. */
export type Doodle = 'sun' | 'cloud' | 'rain' | 'muse' | 'laptop' | 'flower' | 'bird' | 'fish' | 'house' | 'planet' | 'heart' | 'leaf' | 'boat' | 'stars';

/** The back of a postcard: the engine's PostcardBack, with its find and its friend resolved for drawing. */
export type PostcardBack =
  | { kind: 'line'; text: string }
  | { kind: 'doodle'; doodle: Doodle; caption: string }
  /** The planet drawn small, with an X at `dir` (a unit vector from the planet's centre) where the photo was taken. */
  | { kind: 'map'; dir: readonly [number, number, number]; label: string }
  | { kind: 'note'; title: string; lines: readonly string[] }
  | { kind: 'list'; title: string; items: readonly { text: string; done: boolean }[] }
  /** The find pressed like a flower in a book: its species and colour as its bed has them, and a museum label. */
  | { kind: 'pressed'; species: 0 | 1 | 2 | 3; variant: number; label: string }
  /** A travel stub, for a photo from beyond the planet. */
  | { kind: 'ticket'; from: string; to: string; note: string }
  /** Noughts and crosses with the friend in the photo: `board` is nine cells of 'x' (Muse), 'o' (the friend) or '.'. */
  | { kind: 'game'; friend: string; board: string; caption: string }
  /** The answer is printed upside down. */
  | { kind: 'riddle'; question: string; answer: string }
  | { kind: 'tally'; what: string; count: number }
  | { kind: 'poem'; lines: readonly string[] };

export interface Interest {
  id: string;
  name: string;
  /** The flower it grows as: 0 pink cup, 1 white star, 2 yellow button, 3 blue cluster (flowerMeshes.ts). */
  species: 0 | 1 | 2 | 3;
  /** The bed's colour within the species' palette, 0..1 (as the meadow's colony variants). */
  variant: number;
  /** Whether other Muses can see it (Muse's page); private interests never leave the planet. */
  shared: boolean;
  /** When Muse took it up (ISO date). */
  since: string;
}

/** Another Muse that yours has met. */
export interface MuseFriend {
  id: string;
  /** The Muse's own name: never its human's. */
  name: string;
  /** Its coat, as a CSS colour (its portrait is tinted with it). */
  coat: string;
  /** Interests the two share, by name. */
  shared: readonly string[];
  /** When they met (ISO date). */
  met: string;
  /** Set when this Muse's human is your friend there too (no names shown, only the network). */
  knownOn?: 'instagram' | 'facebook';
}

/**
 * Muse's friend group, the owner's setting, widest last: the Muses of people the owner shared Muse with, then also
 * those of the owner's Instagram and Facebook friends, then also strangers met outside the planet. Muse meets,
 * visits and lists only friends inside it; narrowing hides the others and never ends a friendship.
 */
export type Reach = 'shared' | 'known' | 'everyone';

export interface MuseStatus {
  /** At home in its cottage, or out exploring (its door is shut). */
  home: boolean;
  /** Where it is when out (a unit direction on the planet), for its pin and the find button. */
  where?: readonly [number, number, number];
  /** A line about what it is up to. */
  note?: string;
}

export interface MuseProfile {
  name: string;
  /** What soul.md says about it, in a line or two: all it carries into the garden. */
  soul: string;
  status: MuseStatus;
  reach: Reach;
}

/** Everything the garden shows, as of now. */
export interface GardenSnapshot {
  /** The day it is where the owner lives (ISO date), by the backend's clock: the day the post's From today is. */
  today: string;
  /** Muse's own planet, when the backend has one: its seed and growth (0..1), as the URL's `seed` and `g`. */
  world?: { seed: number; g: number };
  muse: MuseProfile;
  interests: readonly Interest[];
  friends: readonly MuseFriend[];
  baskets: readonly Basket[];
  finds: readonly Find[];
  postcards: readonly Postcard[];
  /** Muse's favourite finds, kept on the showpiece shelf in its hut, in its order (find ids); without it the garden picks some (GardenState.favourites). */
  favourites?: readonly string[];
}

/** What the backend pushes while the garden is open. */
export type GardenEvent =
  | { type: 'basket'; basket: Basket; finds: readonly Find[] }
  | { type: 'postcard'; postcard: Postcard }
  | { type: 'status'; status: MuseStatus };

/** What you do in the garden, sent back to Muse: influence, never orders. */
export type Reaction =
  | { type: 'like-find'; id: string; liked: boolean }
  | { type: 'like-postcard'; id: string; liked: boolean }
  | { type: 'favorite-postcard'; id: string; favorite: boolean }
  | { type: 'share-interest'; id: string; shared: boolean }
  | { type: 'share-find'; id: string; shared: boolean }
  | { type: 'use-invitation'; id: string }
  | { type: 'set-reach'; reach: Reach };
