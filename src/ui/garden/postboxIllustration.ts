/** The ink-and-paint version of the approved red mailbox. The door is a rigid
 * plane projected about its bottom hinge, not a swap between two pictures. */

export interface PostboxPose {
  door: number;
  latch: number;
  flag: number;
  cards: number;
  wiggle: number;
}

type Point = readonly [number, number, number];
type ScreenPoint = { x: number; y: number };

const NS = 'http://www.w3.org/2000/svg';
const LEFT = 8;
const TOP = 15;
const WIDTH = 250;
const HEIGHT = WIDTH * 184 / 156;
const FRONT = 0.64;
const BACK = -0.64;
const HINGE = 0.025;
const LATCH_Y = HINGE + 1.25;
const LATCH_Z = FRONT + .055;
const INK = '#51281e';
let nextId = 0;

/** A small downward view, with the front facing left and the right side visible. */
function project([x, y, z]: Point): ScreenPoint {
  return { x: 158 + 80 * x - 45 * z, y: 205 - 80 * y + 8 * x + 20 * z };
}

function xy(p: ScreenPoint): string {
  return `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
}

function polygon(points: readonly Point[]): string {
  return `${points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xy(project(p))}`).join(' ')}Z`;
}

/** The silhouette of an extruded convex profile is the convex envelope of its
 * two projected ends. Joining whole front and rear arcs instead would expose a
 * false valley at their intersection, as though the roof had two humps. */
function bodyOutline(): string {
  const points: ScreenPoint[] = [];
  const curves = [
    [[-.705, .55], [-.7, .97], [-.45, 1.265], [-.015, 1.285]],
    [[-.015, 1.285], [.43, 1.31], [.705, 1.02], [.715, .57]],
  ];
  for (const z of [FRONT, BACK]) {
    points.push(project([-.72, .075 + HINGE, z]), project([-.66, HINGE, z]), project([.66, HINGE, z]), project([.72, .075 + HINGE, z]));
    for (const curve of curves) {
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const u = 1 - t;
        const weights = [u*u*u, 3*u*u*t, 3*u*t*t, t*t*t];
        const x = curve.reduce((sum, point, k) => sum + point[0] * weights[k], 0);
        const y = curve.reduce((sum, point, k) => sum + point[1] * weights[k], HINGE);
        points.push(project([x, y, z]));
      }
    }
  }
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: ScreenPoint, b: ScreenPoint, c: ScreenPoint): number => (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x);
  const half = (ordered: ScreenPoint[]): ScreenPoint[] => {
    const hull: ScreenPoint[] = [];
    for (const point of ordered) {
      while (hull.length >= 2 && cross(hull[hull.length-2], hull[hull.length-1], point) <= 0) hull.pop();
      hull.push(point);
    }
    hull.pop();
    return hull;
  };
  const hull = [...half(points), ...half([...points].reverse())];
  return `${hull.map((point, i) => `${i === 0 ? 'M' : 'L'}${xy(point)}`).join(' ')}Z`;
}

function anchor(point: Point): ScreenPoint {
  const p = project(point);
  return { x: (p.x - LEFT) / WIDTH, y: (p.y - TOP) / HEIGHT };
}

function path(d: string, fill: string, width = 1.9, extra = ''): string {
  return `<path d="${d}" fill="${fill}" stroke="${INK}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
}

/** Local coordinates of the arched front, with the bottom hinge at y = 0. */
const PROFILE = 'M-.66 0 Q-.715 0 -.72 .075 L-.705 .55 C-.7 .97 -.45 1.265 -.015 1.285 C.43 1.31 .705 1.02 .715 .57 L.72 .075 Q.725 .012 .66 0Z';
const INNER = 'M-.626 .055 L.624 .055 L.63 .55 C.625 .94 .39 1.198 -.01 1.205 C-.4 1.19 -.626 .93 -.63 .55Z';

function frontTransform(z = FRONT, y = HINGE): string {
  const p = project([0, y, z]);
  return `matrix(80 8 0 -80 ${p.x} ${p.y})`;
}

export class PostboxIllustration {
  readonly el: SVGSVGElement;
  readonly mouth = anchor([0, 0.25, FRONT + 0.08]);
  readonly countAt = anchor([-0.61, 0.88, FRONT]);
  private readonly drawing: SVGGElement;
  private readonly door: SVGGElement;
  private readonly latch: SVGGElement;
  private readonly flag: SVGGElement;
  private readonly cards: SVGGElement;
  private readonly cardPaths: SVGPathElement[];

  constructor() {
    this.el = document.createElementNS(NS, 'svg');
    this.el.setAttribute('class', 'g-postbox-illustration');
    this.el.setAttribute('viewBox', `${LEFT} ${TOP} ${WIDTH} ${HEIGHT}`);
    // This viewBox matches the desktop 156:184 element, preserving the squat
    // drawing. The near-identical mobile ratio keeps its full-rect anchors exact.
    this.el.setAttribute('preserveAspectRatio', 'none');
    this.el.setAttribute('aria-hidden', 'true');
    this.el.setAttribute('focusable', 'false');
    const id = `postbox-ink-${nextId++}`;
    const p = (x: number, y: number, z: number): string => xy(project([x, y, z]));
    const side = polygon([[.715, .595, FRONT], [.715, .595, BACK], [.72, .055, BACK], [.72, .055, FRONT]]);
    const floor = polygon([[-.63, .08, FRONT], [.63, .08, FRONT], [.63, .08, BACK + .06], [-.63, .08, BACK + .06]]);
    const corridor = polygon([[-.66, .06, FRONT], [.66, .06, FRONT], [.66, .06, FRONT + 1.2], [-.66, .06, FRONT + 1.2]]);

    this.el.innerHTML = `
      <defs>
        <clipPath id="${id}-mouth"><path d="${INNER}" transform="${frontTransform()}"/></clipPath>
        <clipPath id="${id}-mail"><path d="${INNER}" transform="${frontTransform()}"/><path d="${corridor}"/></clipPath>
      </defs>
      <g data-part="drawing" stroke-linecap="round" stroke-linejoin="round">
        <g data-part="post">
          ${path(polygon([[-.205, .01, .18], [.19, .01, .18], [.15, -.24, .18], [.235, -.77, .18], [.19, -.91, .18], [-.15, -.9, .18], [-.18, -.69, .18], [-.23, -.27, .18]]), '#a77247', 2.2)}
          ${path(polygon([[.19, .01, .18], [.19, .01, -.19], [.155, -.26, -.19], [.24, -.77, -.19], [.19, -.89, -.19], [.19, -.91, .18], [.235, -.77, .18], [.15, -.24, .18]]), '#805334', 1.7)}
          ${path(polygon([[-.205, .01, .18], [.19, .01, .18], [.15, -.24, .18], [-.19, -.37, .18]]), '#805334', 0)}
          <path d="M${p(-.12, -.22, .185)}Q${p(-.1, -.45, .185)} ${p(-.08, -.6, .185)} M${p(.01, -.39, .185)}L${p(.065, -.78, .185)} M${p(-.08, -.7, .185)}L${p(-.045, -.84, .185)} M${p(.1, -.055, .185)}L${p(.08, -.19, .185)} M${p(.2, -.35, -.02)}L${p(.23, -.63, -.02)}" stroke="${INK}" stroke-width="1.4" fill="none"/>
        </g>
        ${path(bodyOutline(), '#b94c3b', 2.2)}
        ${path(side, '#993b30', 2.2)}
        ${path(polygon([[.715, .595, FRONT], [.715, .595, BACK], [.72, .31, BACK], [.72, .18, FRONT]]), '#a84334', 0)}
        <path d="M${p(.715, .13, FRONT-.25)}L${p(.715, .24, FRONT-.25)} M${p(.715, .19, FRONT-.19)}L${p(.715, .27, FRONT-.19)} M${p(.64, .82, BACK+.18)}Q${p(.61, .89, BACK+.16)} ${p(.55, .94, BACK+.15)} M${p(.6, .88, FRONT-.13)}Q${p(.56, 1, FRONT-.13)} ${p(.47, 1.075, FRONT-.13)}" fill="none" stroke="${INK}" stroke-width="1.35"/>
        <path d="${PROFILE}" transform="${frontTransform()}" fill="#bb4a38" stroke="${INK}" stroke-width="2.2" vector-effect="non-scaling-stroke"/>
        <path d="${INNER}" transform="${frontTransform()}" fill="#522a22" stroke="${INK}" stroke-width="1.7" vector-effect="non-scaling-stroke"/>
        <g clip-path="url(#${id}-mouth)">
          ${path(floor, '#814133', 1.4)}
          ${path(polygon([[-.63,.08,FRONT],[-.63,.65,FRONT],[-.63,.65,BACK],[-.63,.08,BACK]]), '#643126', 0)}
          <path d="M${p(-.5,.57,FRONT-.1)}Q${p(-.48,.98,FRONT-.15)} ${p(-.13,1.12,FRONT-.16)}" fill="none" stroke="#3f241e" stroke-width="1.3"/>
        </g>
        <g data-part="cards" clip-path="url(#${id}-mail)">
          <path fill="#d7c6a5" stroke="${INK}" stroke-width="1.1"/>
          <path fill="#f2e4c9" stroke="${INK}" stroke-width="1.2"/>
          <path fill="#f8edd7" stroke="${INK}" stroke-width="1.2"/>
        </g>
        <g data-part="door">
          <path d="M-.625 .025 Q-.674 .025 -.677 .085 L-.67 .55 C-.668 .945 -.42 1.227 -.012 1.24 C.396 1.245 .671 .98 .673 .56 L.675 .085 Q.677 .036 .625 .025Z" fill="#bc4b3b" stroke="${INK}" stroke-width="2" vector-effect="non-scaling-stroke"/>
          <path d="M-.67 .55 Q-.652 .335 -.635 .185 L.655 .12 L.669 .55 C.6 .34 -.51 .335 -.67 .55Z" fill="#a94234" opacity=".45"/>
          <path d="M-.63 .54 C-.626 .97 -.378 1.186 -.014 1.197 C.32 1.205 .565 1.033 .625 .72" fill="none" stroke="#d35f48" stroke-width="2.2" vector-effect="non-scaling-stroke"/>
          <path d="M-.58 .12L-.42 .105 M.54 .43L.55 .32" fill="none" stroke="#7c3027" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
        </g>
        <g data-part="latch-tab">
          <path d="M-.065 0L-.062-.23Q0-.31 .065-.232L.065 0Z" fill="#d1a35d" stroke="${INK}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
          <path d="M-.035-.035L-.032-.216Q-.023-.246-.003-.253" fill="none" stroke="#f0d39a" stroke-width="1.1" vector-effect="non-scaling-stroke"/>
        </g>
        <g data-part="latch-barrel" transform="${frontTransform(LATCH_Z, LATCH_Y)}">
          <path d="M-.072 .041Q-.087 .039-.087 .002L-.075-.021L.075-.021Q.092-.009 .084 .031L.071 .043Z" fill="#d3ae70" stroke="${INK}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
          <path d="M-.064 .025L.054 .029" stroke="#f1d298" stroke-width="1.2" vector-effect="non-scaling-stroke"/>
        </g>
        <g data-part="hinges">${[-.59,.59].map((x) => {
          const at = project([x, HINGE + .04, FRONT + .035]);
          return `<g transform="translate(${at.x} ${at.y}) rotate(5.71)"><path d="M-7-3Q-9 0-7 4H5Q8 1 5-3Z" fill="#bd9153" stroke="${INK}" stroke-width="1.6"/><path d="M-5-2H3" stroke="#ead199" stroke-width="1.2"/><ellipse cx="5" cy=".5" rx="2.3" ry="3.4" fill="#9c713d" stroke="${INK}" stroke-width="1.3"/></g>`;
        }).join('')}</g>
        <g data-part="rivets">${[.38,-.14,-.54].map((z) => {
          const at = project([.73, .13, z]);
          return `<ellipse cx="${at.x}" cy="${at.y}" rx="3.1" ry="4" fill="#ba955c" stroke="${INK}" stroke-width="1.5"/>`;
        }).join('')}</g>
        <g data-part="flag"><path d="M-.045-.025L.042-.035L.052 1.15Q.055 1.188 .004 1.19L-.55 1.167Q-.59 1.16 -.59 1.125L-.575 .84Q-.575 .803 -.53 .805L-.045 .82Z" fill="#b94c3b" stroke="${INK}" stroke-width="2.1" vector-effect="non-scaling-stroke"/><path d="M-.018 .08L.005 1.14L-.54 1.122" fill="none" stroke="#d5624a" stroke-width="2" vector-effect="non-scaling-stroke"/></g>
        <ellipse data-part="flag-hub" cx="${project([.765,.39,-.12]).x}" cy="${project([.765,.39,-.12]).y}" rx="4.7" ry="6.3" fill="#bf985c" stroke="${INK}" stroke-width="1.8"/>
      </g>`;
    this.drawing = this.el.querySelector<SVGGElement>('[data-part="drawing"]')!;
    this.door = this.el.querySelector<SVGGElement>('[data-part="door"]')!;
    this.latch = this.el.querySelector<SVGGElement>('[data-part="latch-tab"]')!;
    this.flag = this.el.querySelector<SVGGElement>('[data-part="flag"]')!;
    this.cards = this.el.querySelector<SVGGElement>('[data-part="cards"]')!;
    this.cardPaths = Array.from(this.cards.querySelectorAll('path'));
    this.render({ door: 0, latch: 0, flag: 0, cards: 0, wiggle: 0 }, true);
  }

  render(state: PostboxPose, hasCards: boolean): void {
    const angle = Math.max(0, Math.min(1.06, state.door)) * 1.62;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const hinge = project([0, HINGE, FRONT + .015]);
    // Transform local (x, y) after rotating y into the forward z direction.
    this.door.setAttribute('transform', `matrix(80 8 ${-45*s} ${-80*c+20*s} ${hinge.x} ${hinge.y})`);
    // The keeper belongs to the fixed rim. Lift its hanging tab outward/up
    // before lowering the door; its barrel stays above the opening throughout.
    // Near upright at 160 degrees, the lifted tab has a distinct silhouette
    // above its barrel even at the 116px mobile mailbox size.
    const latchAngle = -Math.PI * (160 / 180) * Math.max(0, Math.min(1, state.latch));
    const lc = Math.cos(latchAngle);
    const ls = Math.sin(latchAngle);
    const latchHinge = project([0, LATCH_Y, LATCH_Z]);
    this.latch.setAttribute('transform', `matrix(80 8 ${-45*ls} ${-80*lc+20*ls} ${latchHinge.x} ${latchHinge.y})`);
    this.el.dataset.latch = state.latch > .98 ? 'lifted' : state.latch < .02 ? 'latched' : 'moving';
    const flagAngle = (1 - state.flag) * Math.PI / 2;
    const fc = Math.cos(flagAngle);
    const fs = Math.sin(flagAngle);
    const hub = project([.765, .39, -.12]);
    // The flag's local x is z (along the side), and local y points upward.
    this.flag.setAttribute('transform', `matrix(${-45*fc} ${80*fs+20*fc} ${-45*fs} ${-80*fc+20*fs} ${hub.x} ${hub.y})`);
    const travel = Math.max(0, Math.min(1, state.cards));
    this.cards.style.display = hasCards && state.door > .06 ? '' : 'none';
    this.cardPaths.forEach((card, k) => {
      const z = .45 + travel * .38 - k * .018;
      const y = .086 + k * .019 + travel * .12;
      const x = (k - 1) * .014;
      card.setAttribute('d', polygon([[x-.48,y,z], [x+.48,y,z], [x+.48,y,z-.57], [x-.48,y,z-.57]]));
    });
    const w = state.wiggle > 0 && state.wiggle < 1 ? Math.sin(state.wiggle * Math.PI * 4) * (1 - state.wiggle) : 0;
    this.drawing.setAttribute('transform', `rotate(${w * 2.2} 158 276)`);
    this.el.dataset.door = state.door > .98 ? 'open' : state.door < .02 ? 'closed' : 'moving';
  }
}
