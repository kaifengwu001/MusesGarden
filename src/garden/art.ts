// Placeholder pictures for the example finds: small flat illustrations in
// soft colours, one motif per interest, drawn as SVG (no files to fetch) and
// used over and over until a backend sends real thumbnails. Each motif is
// drawn at the aspect its media kind usually has.

export type Motif = 'clay' | 'flow' | 'light' | 'slope' | 'kit' | 'sky' | 'noodles' | 'fern' | 'arch' | 'vinyl';

/** A small seeded generator, so a motif draws the same every time. */
function rand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number): string => n.toFixed(1);

function svg(w: number, h: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>`;
}

function clay(): string {
  // three glazed pots on a shelf against a warm wall
  const pot = (x: number, w: number, h: number, body: string, glaze: string, lip: number): string =>
    `<path d="M${f(x - w * 0.32)} 300 C${f(x - w * 0.62)} ${f(300 - h * 0.35)} ${f(x - w * 0.55)} ${f(300 - h * 0.8)} ${f(x - lip)} ${f(300 - h)} L${f(x + lip)} ${f(300 - h)} C${f(x + w * 0.55)} ${f(300 - h * 0.8)} ${f(x + w * 0.62)} ${f(300 - h * 0.35)} ${f(x + w * 0.32)} 300 Z" fill="${body}"/>` +
    `<path d="M${f(x - lip)} ${f(300 - h)} L${f(x + lip)} ${f(300 - h)} C${f(x + w * 0.5)} ${f(300 - h * 0.78)} ${f(x + w * 0.58)} ${f(300 - h * 0.55)} ${f(x + w * 0.56)} ${f(300 - h * 0.45)} C${f(x)} ${f(300 - h * 0.38)} ${f(x - w * 0.3)} ${f(300 - h * 0.5)} ${f(x - w * 0.56)} ${f(300 - h * 0.45)} C${f(x - w * 0.58)} ${f(300 - h * 0.55)} ${f(x - w * 0.5)} ${f(300 - h * 0.78)} ${f(x - lip)} ${f(300 - h)} Z" fill="${glaze}"/>` +
    `<ellipse cx="${f(x)}" cy="${f(300 - h)}" rx="${f(lip)}" ry="4" fill="#5b4636" opacity="0.55"/>` +
    `<path d="M${f(x - w * 0.18)} ${f(300 - h * 0.9)} q-10 ${f(h * 0.3)} -4 ${f(h * 0.62)}" stroke="#fff" stroke-opacity="0.35" stroke-width="5" fill="none" stroke-linecap="round"/>`;
  return svg(
    320,
    400,
    `<rect width="320" height="400" fill="#f1dcc4"/><rect y="300" width="320" height="100" fill="#d9b48f"/>` +
      `<rect y="296" width="320" height="10" fill="#c49a73"/><ellipse cx="160" cy="306" rx="150" ry="6" fill="#8a6446" opacity="0.25"/>` +
      `<circle cx="250" cy="96" r="54" fill="#f7e9d6"/>` +
      pot(84, 92, 150, '#c9876a', '#8fb3ab', 18) +
      pot(178, 74, 104, '#e2c9a8', '#d98f7a', 14) +
      pot(250, 64, 178, '#b98a6c', '#efe6d4', 12),
  );
}

function flow(): string {
  // generative lines drifting across a dusk field
  const r = rand(7);
  const colours = ['#f2b880', '#e8846f', '#c86b85', '#8d77ab', '#79a8c9', '#f6dcae'];
  let lines = '';
  for (let i = 0; i < 46; i++) {
    const y0 = 20 + i * 13.5 + r() * 6;
    const amp = 18 + r() * 34;
    const ph = r() * 6.28;
    const k = 0.012 + r() * 0.01;
    let d = `M-10 ${f(y0)}`;
    for (let x = 0; x <= 380; x += 20) d += ` L${x} ${f(y0 + Math.sin(x * k + ph) * amp + Math.sin(x * 0.031 + i) * 6)}`;
    lines += `<path d="${d}" fill="none" stroke="${colours[i % colours.length]}" stroke-opacity="${f(0.55 + 0.4 * r())}" stroke-width="${f(1.2 + r() * 2.4)}" stroke-linecap="round"/>`;
  }
  return svg(360, 640, `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#26304f"/><stop offset="1" stop-color="#3d2f4f"/></linearGradient></defs><rect width="360" height="640" fill="url(#g)"/>${lines}`);
}

function light(): string {
  // a ring of light in a dark gallery, mirrored in a polished floor
  return svg(
    360,
    640,
    `<defs><radialGradient id="h" cx="0.5" cy="0.42" r="0.6"><stop offset="0" stop-color="#3a3550"/><stop offset="1" stop-color="#14131c"/></radialGradient>` +
      `<filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9"/></filter></defs>` +
      `<rect width="360" height="640" fill="url(#h)"/><rect y="420" width="360" height="220" fill="#100f16"/>` +
      `<circle cx="180" cy="270" r="112" fill="none" stroke="#ffd9a0" stroke-width="22" filter="url(#b)" opacity="0.8"/>` +
      `<circle cx="180" cy="270" r="112" fill="none" stroke="#fff4dc" stroke-width="5"/>` +
      `<ellipse cx="180" cy="520" rx="112" ry="26" fill="none" stroke="#ffd9a0" stroke-width="10" filter="url(#b)" opacity="0.45"/>` +
      `<ellipse cx="180" cy="520" rx="112" ry="26" fill="none" stroke="#fff4dc" stroke-width="2" opacity="0.55"/>` +
      `<rect x="168" y="392" width="7" height="30" rx="3" fill="#0b0a10"/><circle cx="171.5" cy="386" r="6" fill="#0b0a10"/>`,
  );
}

function slope(): string {
  // a snowy slope under a blue sky, one skier's tracks curving down
  return svg(
    360,
    640,
    `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5f9fd6"/><stop offset="1" stop-color="#bfe0f2"/></linearGradient></defs>` +
      `<rect width="360" height="640" fill="url(#s)"/>` +
      `<path d="M0 250 L70 170 L120 210 L190 120 L260 200 L310 160 L360 210 L360 330 L0 330 Z" fill="#e8f1f7"/>` +
      `<path d="M190 120 L215 150 L200 148 L222 182 L190 160 Z M70 170 L86 190 L72 188 Z" fill="#c8d9e6"/>` +
      `<path d="M0 300 C120 270 240 290 360 260 L360 640 L0 640 Z" fill="#f7fbfd"/>` +
      `<path d="M210 300 C150 360 260 410 180 470 C110 520 230 560 160 640" fill="none" stroke="#c9dbe8" stroke-width="5" stroke-linecap="round"/>` +
      `<path d="M219 300 C159 360 269 410 189 470 C119 520 239 560 169 640" fill="none" stroke="#d6e4ee" stroke-width="3" stroke-linecap="round"/>` +
      `<g transform="translate(205 296) rotate(-14)"><rect x="-3" y="-20" width="9" height="16" rx="4" fill="#e05a4f"/><circle cx="1.5" cy="-24" r="4.5" fill="#2f3a4a"/><rect x="-10" y="-2" width="24" height="3" rx="1.5" fill="#2f3a4a"/></g>` +
      `<g fill="#6f8f7a">${[30, 64, 300, 330].map((x, i) => `<path d="M${x} ${330 + (i % 2) * 14} l12 30 h-24 Z"/>`).join('')}</g>`,
  );
}

function kit(): string {
  // a model kit's runner of grey parts on a green cutting mat
  let grid = '';
  for (let i = 0; i <= 16; i++) grid += `<path d="M${i * 20} 0 V400 M0 ${i * 25} H320" stroke="#e7f1e3" stroke-opacity="0.35" stroke-width="1"/>`;
  const parts = [
    `<rect x="62" y="86" width="64" height="40" rx="10"/>`,
    `<path d="M170 80 h70 l12 22 l-12 22 h-70 l-10 -22 Z"/>`,
    `<rect x="70" y="170" width="28" height="78" rx="12"/>`,
    `<rect x="122" y="168" width="28" height="84" rx="12"/>`,
    `<circle cx="210" cy="206" r="30"/><circle cx="210" cy="206" r="12" fill="#c5cbd3"/>`,
    `<path d="M66 290 h86 v30 h-30 v22 h-26 v-22 h-30 Z"/>`,
    `<rect x="186" y="284" width="64" height="58" rx="8"/>`,
  ];
  return svg(
    320,
    400,
    `<rect width="320" height="400" fill="#4f7d63"/>${grid}` +
      `<g fill="none" stroke="#b9c0c9" stroke-width="7" stroke-linejoin="round"><rect x="40" y="56" width="240" height="306" rx="6"/><path d="M40 150 H280 M40 270 H280 M160 56 V362"/></g>` +
      `<g fill="#dde1e6" stroke="#aeb5be" stroke-width="2">${parts.join('')}</g>` +
      `<g stroke="#b9c0c9" stroke-width="4"><path d="M126 106 H160 M94 150 v20 M136 150 v18 M210 176 V150 M110 270 v20 M218 270 v14"/></g>`,
  );
}

function sky(): string {
  // a ringed planet over a dark hill, stars, a telescope
  const r = rand(11);
  let stars = '';
  for (let i = 0; i < 90; i++) stars += `<circle cx="${f(r() * 640)}" cy="${f(r() * 260)}" r="${f(0.6 + r() * 1.6)}" fill="#fff" opacity="${f(0.4 + r() * 0.6)}"/>`;
  return svg(
    640,
    360,
    `<defs><linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#151b3b"/><stop offset="1" stop-color="#3b4377"/></linearGradient>` +
      `<linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f4d6a6"/><stop offset="1" stop-color="#c98a6b"/></linearGradient></defs>` +
      `<rect width="640" height="360" fill="url(#n)"/>${stars}` +
      `<ellipse cx="420" cy="130" rx="118" ry="24" fill="none" stroke="#e9d7bb" stroke-width="7" opacity="0.7" transform="rotate(-14 420 130)"/>` +
      `<circle cx="420" cy="130" r="58" fill="url(#p)"/>` +
      `<path d="M362 147 A58 58 0 0 0 476 116" fill="none" stroke="#f1e3c8" stroke-width="7" opacity="0.85" transform="rotate(-14 420 130)"/>` +
      `<path d="M0 300 C150 250 290 270 420 300 C520 322 590 300 640 290 L640 360 L0 360 Z" fill="#1b2140"/>` +
      `<g transform="translate(150 262) rotate(-28)"><rect x="-6" y="-6" width="70" height="16" rx="5" fill="#d7dbe6"/><rect x="62" y="-9" width="12" height="22" rx="3" fill="#aeb4c6"/></g>` +
      `<path d="M160 270 l-18 34 M160 270 l16 34 M160 270 v36" stroke="#d7dbe6" stroke-width="3"/>`,
  );
}

function noodles(): string {
  // a bowl of noodles from above
  const r = rand(5);
  let strands = '';
  for (let i = 0; i < 22; i++) {
    const a = r() * 6.28;
    const rad = 30 + r() * 70;
    strands += `<path d="M${f(200 + Math.cos(a) * rad)} ${f(200 + Math.sin(a) * rad)} q${f(-30 + r() * 60)} ${f(-30 + r() * 60)} ${f(-40 + r() * 80)} ${f(-40 + r() * 80)}" stroke="#f3dca0" stroke-width="7" fill="none" stroke-linecap="round" opacity="0.95"/>`;
  }
  return svg(
    400,
    400,
    `<rect width="400" height="400" fill="#9cc3c9"/><circle cx="210" cy="212" r="150" fill="#7aa3aa" opacity="0.5"/>` +
      `<circle cx="200" cy="200" r="150" fill="#f6f1e7"/><circle cx="200" cy="200" r="128" fill="#c77a4f"/><circle cx="200" cy="200" r="122" fill="#d98c58"/>` +
      strands +
      `<g transform="translate(250 150)"><ellipse rx="34" ry="28" fill="#fbf6ea"/><circle r="15" fill="#f2a93b"/></g>` +
      `<g fill="#6aa35a"><ellipse cx="140" cy="250" rx="26" ry="10" transform="rotate(-30 140 250)"/><ellipse cx="160" cy="268" rx="22" ry="9" transform="rotate(20 160 268)"/></g>` +
      `<g fill="#f7c6c6"><circle cx="250" cy="250" r="14"/><circle cx="250" cy="250" r="6" fill="#fff"/></g>` +
      `<path d="M305 70 L360 330" stroke="#8a5a3c" stroke-width="7" stroke-linecap="round"/><path d="M325 66 L372 324" stroke="#8a5a3c" stroke-width="7" stroke-linecap="round"/>`,
  );
}

function fern(): string {
  // fern fronds pressed on cream paper
  const frond = (x: number, y: number, angle: number, len: number, colour: string): string => {
    let leaves = '';
    for (let i = 1; i < 16; i++) {
      const t = i / 16;
      const l = len * 0.28 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 4;
      const yy = -t * len;
      leaves += `<ellipse cx="${f(l * 0.55)}" cy="${f(yy)}" rx="${f(l * 0.55)}" ry="${f(4 + l * 0.12)}" transform="rotate(-24 0 ${f(yy)})"/>`;
      leaves += `<ellipse cx="${f(-l * 0.55)}" cy="${f(yy)}" rx="${f(l * 0.55)}" ry="${f(4 + l * 0.12)}" transform="rotate(24 0 ${f(yy)})"/>`;
    }
    return `<g transform="translate(${x} ${y}) rotate(${angle})" fill="${colour}"><path d="M0 0 V${-len}" stroke="${colour}" stroke-width="3"/>${leaves}</g>`;
  };
  return svg(640, 360, `<rect width="640" height="360" fill="#f3ecdc"/>` + frond(210, 360, -18, 300, '#6f9a6a') + frond(330, 380, 8, 340, '#4f7d5b') + frond(470, 370, 26, 270, '#8db07a'));
}

function arch(): string {
  // a terracotta stair and arches under hard sun
  return svg(
    640,
    360,
    `<rect width="640" height="360" fill="#9fd0ea"/>` +
      `<rect x="40" y="60" width="560" height="300" fill="#e59a7c"/>` +
      `<g fill="#9fd0ea">${[110, 250, 390, 530].map((x) => `<path d="M${x - 44} 230 V140 A44 44 0 0 1 ${x + 44} 140 V230 Z"/>`).join('')}</g>` +
      `<g fill="#c4705a">${[110, 250, 390, 530].map((x) => `<path d="M${x - 44} 230 V140 A44 44 0 0 1 ${x - 20} 103 V230 Z"/>`).join('')}</g>` +
      `<path d="M40 360 L40 290 L220 290 L220 260 L330 260 L330 230 L600 230 L600 360 Z" fill="#f0b297"/>` +
      `<path d="M220 290 L220 260 L330 260 L330 230 L360 230 L360 262 L250 262 L250 292 Z" fill="#c4705a" opacity="0.6"/>` +
      `<rect x="40" y="52" width="560" height="12" fill="#f3c1a8"/>`,
  );
}

function vinyl(): string {
  // a record half out of its sleeve
  let grooves = '';
  for (let r = 40; r < 128; r += 7) grooves += `<circle r="${r}" fill="none" stroke="#2c2c34" stroke-width="1.2" opacity="0.8"/>`;
  return svg(
    400,
    400,
    `<rect width="400" height="400" fill="#efe2c8"/>` +
      `<g transform="translate(240 200)"><circle r="132" fill="#18181d"/>${grooves}<circle r="38" fill="#e8846f"/><circle r="5" fill="#efe2c8"/><path d="M-90 -80 A120 120 0 0 1 20 -128" stroke="#fff" stroke-opacity="0.12" stroke-width="18" fill="none"/></g>` +
      `<rect x="40" y="68" width="200" height="264" fill="#7fa7c9"/><circle cx="140" cy="168" r="48" fill="#f6dcae"/><rect x="66" y="270" width="140" height="10" rx="5" fill="#fbf8ee" opacity="0.8"/><rect x="66" y="290" width="90" height="8" rx="4" fill="#fbf8ee" opacity="0.6"/>`,
  );
}

const MOTIFS: Record<Motif, () => string> = { clay, flow, light, slope, kit, sky, noodles, fern, arch, vinyl };
const cache = new Map<Motif, string>();

/** A motif as a data URL for an <img>. */
export function art(motif: Motif): string {
  let url = cache.get(motif);
  if (!url) {
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(MOTIFS[motif]())}`;
    cache.set(motif, url);
  }
  return url;
}

/** Each motif's width over height, as drawn. */
export const MOTIF_ASPECT: Record<Motif, number> = {
  clay: 4 / 5,
  flow: 9 / 16,
  light: 9 / 16,
  slope: 9 / 16,
  kit: 4 / 5,
  sky: 16 / 9,
  noodles: 1,
  fern: 16 / 9,
  arch: 16 / 9,
  vinyl: 1,
};

/** A friend's world, for its invitation and the travel sheet: a redwood grove in fog with a small shrine (placeholder). */
export function worldArt(_world: string): string {
  const r = rand(23);
  let trees = '';
  for (let i = 0; i < 9; i++) {
    const x = 20 + i * 76 + r() * 30;
    const w = 26 + r() * 22;
    const far = i % 2 === 0;
    trees += `<rect x="${f(x)}" y="0" width="${f(w)}" height="300" fill="${far ? '#b9a08a' : '#8c5e48'}" opacity="${far ? 0.55 : 1}"/>`;
    trees += `<rect x="${f(x + w * 0.62)}" y="0" width="${f(w * 0.16)}" height="300" fill="#fff" opacity="0.08"/>`;
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    svg(
      720,
      360,
      `<defs><linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe6dc"/><stop offset="1" stop-color="#b9cdb6"/></linearGradient>` +
        `<linearGradient id="mist" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f3f1e6" stop-opacity="0"/><stop offset="1" stop-color="#f3f1e6" stop-opacity="0.9"/></linearGradient></defs>` +
        `<rect width="720" height="360" fill="url(#fog)"/>${trees}` +
        `<path d="M0 270 C140 250 260 262 360 270 C470 280 600 258 720 262 L720 360 L0 360 Z" fill="#7d9a6a"/>` +
        `<g transform="translate(372 214)"><path d="M-46 0 L0 -30 L46 0 Z" fill="#9b3d33"/><rect x="-34" y="0" width="68" height="44" fill="#e8ddc6"/><rect x="-10" y="14" width="20" height="30" fill="#5b4636"/><rect x="-40" y="-4" width="80" height="6" fill="#7a2f28"/></g>` +
        `<g fill="#c94f40"><rect x="250" y="226" width="7" height="60"/><rect x="300" y="226" width="7" height="60"/><rect x="240" y="222" width="78" height="7"/><rect x="246" y="236" width="66" height="5"/></g>` +
        `<rect width="720" height="360" fill="url(#mist)"/>`,
    ),
  )}`;
}
