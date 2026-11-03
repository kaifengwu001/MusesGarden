/**
 * The homestead view, after the painting: the camera's height (m) and
 * distance (m) from the point it looks at (cottage-local x, y, z, m), its
 * bearing from the front toward the right end (rad). The groves keep its
 * sight line open (life/cherryDistribution.ts).
 */
export const HOMESTEAD_VIEW = { height: 16, distance: 38, azimuth: 0.92, at: [-1.8, 3.0, 3.4] } as const;
