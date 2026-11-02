import { COTTAGE_FOOTPRINT } from './cottageSite';

/** A 40 cm stone border hugs the walls. The two rectangles partition its
 * stepped outline, including the courtyard, without overlapping floor caps. */
const border=.4,rear=COTTAGE_FOOTPRINT[0],front=COTTAGE_FOOTPRINT[1];
export const COTTAGE_PAVING=[
  {x0:rear.x0-border,x1:rear.x1+border,z0:rear.z0-border,z1:front.z0-border},
  {x0:front.x0-border,x1:front.x1+border,z0:front.z0-border,z1:front.z1+border},
] as const;
const a=COTTAGE_PAVING[0],b=COTTAGE_PAVING[1];
export const COTTAGE_PAVING_EDGE=[[a.x0,a.z0],[a.x1,a.z0],[a.x1,a.z1],[b.x1,b.z0],
  [b.x1,b.z1],[b.x0,b.z1],[b.x0,b.z0],[a.x0,a.z1]] as const;
