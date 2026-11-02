/** Close views of the defects reported 1 Nov, shared by art and motion checks. */
export const DETAIL_VIEWS = {
  steps: { at: [0, 0.40, 4.75], height: 1.75, distance: 3.8, azimuth: 0.04 },
  plum: { at: [-6.6, 1.45, 2.5], height: 1.8, distance: 4.8, azimuth: 0.30 },
  cedar: { at: [25, 3.7, 0], height: 4.5, distance: 10.5, azimuth: 1.2 },
  roof: { at: [0, 4.2, 0], height: 6.5, distance: 11, azimuth: 0.28 },
  water: { at: [12, -0.8, 20], height: 3.6, distance: 10.0, azimuth: 0.30 },
} as const;
