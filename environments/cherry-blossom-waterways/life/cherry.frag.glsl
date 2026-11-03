#include <meadow_common>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_noise>
varying vec3 vNormal;
varying vec3 vLocalNormal;
varying vec3 vPlanet;
varying vec3 vLocal;
varying vec3 vWorld;
varying vec2 vUv;
varying float vKind;
varying float vTint;
varying float vBloom;
varying float vShade;
varying float vScale;
varying float vSeed;
varying vec3 vPuff;
varying vec3 vViewT;
varying vec3 vSunT;

const float TAU = 6.2831853;

// One cherry blossom, `q` in blossom radii (the petal tips at about 1) and
// `aa` its edge softness in the same units: five rounded petals overlapping
// toward the heart, each with a small cleft at its tip, around a rose centre
// ringed with anthers. Returns (cover, heart: 0 at the rim to 1 at the
// centre, the seam between two petals, anther).
vec4 sakura(vec2 q, float aa) {
  float r = length(q);
  float angle = atan(q.y, q.x);
  float f = angle / (TAU / 5.0);
  // Along and across the nearest petal.
  float t = (f - floor(f + 0.5)) * (TAU / 5.0);
  vec2 s = r * vec2(cos(t), sin(t));
  float petal = length(s - vec2(0.55, 0.0)) - 0.42;
  float cleft = (0.86 + 1.6 * abs(s.y) - s.x) / 1.9;
  float cover = 1.0 - smoothstep(-aa, aa, max(petal, -cleft));
  float heart = 1.0 - smoothstep(0.04, 0.62, r);
  // Seams and anthers are lost below a few pixels.
  if (aa > 0.12) return vec4(cover, heart, 0.0, 0.0);
  float seam = (1.0 - smoothstep(0.0, 0.035 + aa, (TAU / 10.0 - abs(t)) * r)) * smoothstep(0.18, 0.35, r);
  // Ten anthers on short filaments, between the petals' axes.
  float g = angle / (TAU / 10.0) + 0.5;
  float ta = (g - floor(g + 0.5)) * (TAU / 10.0);
  vec2 a = r * vec2(cos(ta), sin(ta));
  float anther = 1.0 - smoothstep(0.05 - aa, 0.05 + aa, length(a - vec2(0.3, 0.0)));
  float filament = (1.0 - smoothstep(0.0, 0.012 + aa, abs(a.y))) * (1.0 - smoothstep(0.26, 0.3, r)) * step(0.1, r);
  return vec4(cover, heart, seam, max(anther, 0.6 * filament));
}

// A blossom's pigment: blush or near-white petals, pinker toward the heart,
// a rose centre and pale gold anthers.
vec3 blossomColour(vec4 s, float tint, float ivory) {
  vec3 tip = mix(vec3(0.99, 0.79, 0.87), vec3(1.0, 0.94, 0.95), max(tint * 0.75, ivory));
  vec3 col = mix(tip, vec3(0.96, 0.60, 0.74), s.y * s.y);
  col = mix(col, vec3(0.80, 0.28, 0.46), smoothstep(0.72, 0.92, s.y));
  col *= 1.0 - 0.14 * s.z;
  return mix(col, vec3(0.99, 0.85, 0.60), 0.85 * s.w);
}

// Blossoms over a puff, in lattice cells FLOWER m (of the tree's template)
// across. Each cell holds one blossom about its jittered centre, among the
// puff's blossoms if near enough its surface, and facing its own way: out
// from the surface, tilted by up to about 45°. Its petals form a shallow cup
// (CUP: how far the tips rise, in blossom radii). The view ray from the
// surface point is traced to each blossom's cup, so a tilted one shows
// foreshortened or edge on as a bowl; the nearest it meets covers the rest,
// and one just beside the ray and nearer shades the one met. The 2×2×2 cells
// about a point hold every blossom met within REACH (cells) of it; two
// offset lattices leave few gaps. Returns the blossom met (as sakura) and,
// in `look`: its tint, how its petals face the sun (-1 to 1), how deep it
// lies with any shadow on it, and 1 where its back is seen.
const float FLOWER = 0.22;
const float REACH = 0.3;
const float CUP = 0.35;
vec4 puffBlossom(vec3 p, vec3 n, vec3 view, vec3 sun, float footprint, out vec4 look) {
  vec4 bloom = vec4(0.0);
  look = vec4(0.0, 1.0, 0.0, 0.0);
  float best = -1e3, deep = 0.0;
  float shadow = 0.0, shadowAt = -1e3;
  for (int layer = 0; layer < 2; layer++) {
    vec3 lp = p + float(layer) * vec3(0.43, 0.29, 0.61);
    vec3 base = floor(lp - 0.5);
    for (int k = 0; k < 8; k++) {
      vec3 cell = base + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
      uint h = meadowHash(ivec3(cell), 523u + uint(layer) * 97u);
      vec3 d = lp - (cell + 0.5 + 0.2 * (vec3(float(h & 255u), float((h >> 8) & 255u), float((h >> 16) & 255u)) / 255.0 - 0.5));
      float height = dot(d, n);
      if (abs(height) > 0.45) continue;
      // Its tilt and turn from a second hash, without trigonometry.
      uint g = (h ^ (h >> 16)) * 0x45d9f3bu;
      g ^= g >> 16;
      vec3 tilt = vec3(float(g & 255u), float((g >> 8) & 255u), float((g >> 16) & 255u)) / 127.5 - 1.0;
      vec3 m = normalize(n + 0.6 * tilt);
      float facing = dot(view, m);
      if (abs(facing) < 0.05) continue;
      float radius = 0.5 + 0.15 * float((h >> 24) & 15u) / 15.0;
      // Meet the plane through the blossom's centre, then its cup, risen r² × CUP there;
      // only a ray that meets it near its centre needs the blossom's own axes.
      float t = -dot(d, m) / facing;
      vec3 at = d + view * t;
      float r2 = dot(at, at) / (radius * radius);
      if (r2 > 2.0) continue;
      t += CUP * radius * r2 / facing;
      if (abs(t) > REACH || t < best) continue;
      at = d + view * t;
      at -= m * dot(at, m);
      r2 = dot(at, at) / (radius * radius);
      if (r2 > 1.7) continue;
      float spin = float(g >> 24) / 127.5 - 1.0;
      vec3 u = cross(m, vec3(spin, 0.4, 1.0 - abs(spin)));
      float ul = length(u);
      if (ul < 0.2) continue;
      u /= ul;
      vec3 w = cross(m, u);
      vec2 q = vec2(dot(at, u), dot(at, w)) / radius;
      vec4 s = sakura(q, footprint / (radius * max(abs(facing), 0.3)));
      if (s.x > 0.5) {
        best = t;
        bloom = s;
        deep = height;
        vec3 petal = sign(facing) * normalize(m - 2.0 * CUP * (q.x * u + q.y * w));
        look = vec4(float(h >> 28) / 15.0, dot(petal, sun), 0.0, step(facing, 0.0));
      } else {
        float near = 1.0 - smoothstep(0.9, 1.3, sqrt(r2));
        if (near > shadow) { shadow = near; shadowAt = t; }
      }
    }
  }
  look.z = 0.6 * smoothstep(-0.45, 0.45, deep) + (shadowAt > best ? 0.5 * shadow : 0.0);
  return bloom;
}

// A far puff is an icosahedron enclosing its ellipsoid, this much larger
// (PROXY_INSET in cherryGeometry.ts).
const float PROXY = 0.7947;

// Clusters of blossom seen from afar: two offset lattices of round blots, each
// its own pink or near-white. `footprint` (lattice cells a pixel) fades the
// pattern to its mean before it would shimmer.
const float PETAL = 0.18;
const float CLUSTER = 0.5;
vec4 blots(vec3 q, float footprint, uint seed) {
  vec4 acc = vec4(0.0);
  for (int layer = 0; layer < 2; layer++) {
    vec3 p = q + float(layer) * vec3(0.5, 0.37, 0.71);
    vec3 cell = floor(p);
    uint h = meadowHash(ivec3(cell), seed + uint(layer) * 37u);
    vec3 jitter = vec3(float(h & 255u), float((h >> 8) & 255u), float((h >> 16) & 255u)) / 255.0;
    float d = length(p - cell - 0.25 - 0.5 * jitter);
    float size = 0.34 + 0.14 * float((h >> 24) & 15u) / 15.0;
    float cover = 1.0 - smoothstep(size - footprint - 0.03, size + footprint + 0.03, d);
    float tint = float((h >> 28) & 15u) / 15.0;
    acc = mix(acc, vec4(tint, 0.0, 0.0, 1.0), cover);
  }
  return acc;
}

void main() {
  vec3 n = normalize(vNormal);
  float light = 0.55 + 0.45*toonLight(dot(n,uSunDir));
  // Lattices in the tree's own meters; derivatives taken before any branch on the kind.
  vec3 petalCell = vLocal * vScale / PETAL;
  float footprint = length(fwidth(petalCell));
  float clusterPrint = footprint * PETAL / CLUSTER;
  float flowerPrint = length(fwidth(vLocal / FLOWER));
  float uvPrint = length(fwidth(vUv));
  vec3 col;
  if(vKind < 0.5) {
    float stroke = sin(vLocal.y*2.7 + sin(vLocal.x*11.0+vLocal.z*8.0)*1.8);
    col = mix(vec3(0.035,0.046,0.043),vec3(0.125,0.098,0.091),vTint*0.5+light*0.5);
    col += vec3(0.026,0.018,0.019)*smoothstep(0.55,0.85,stroke);
  } else if(vKind < 2.5) {
    // A loose blossom card, or far off a hanging string of them.
    // Its front faces where its normal points; from behind, no anthers and a deeper blush.
    vec4 bloom = sakura(vec2(vUv.x, mod(vUv.y + 1.0, 2.0) - 1.0), max(uvPrint, 1e-3));
    if (bloom.x < 0.5) discard;
    float lit = smoothstep(-0.4, 0.9, dot(gl_FrontFacing ? n : -n, uSunDir));
    bloom.w *= gl_FrontFacing ? 1.0 : 0.0;
    col = blossomColour(bloom, vTint, step(1.5, vKind)) * (gl_FrontFacing ? vec3(1.0) : vec3(0.93,0.8,0.86));
    col *= 0.8 + 0.24*lit;
    col = mix(col,vec3(0.72,0.38,0.58),0.12*(1.0-light));
    col = mix(col, col*vec3(0.88,0.64,0.75), vShade*0.8);
    col = mix(vec3(0.32,0.50,0.16)*(0.85+0.15*light),col,vBloom);
  } else if(vKind > 4.5) {
    // A blossom puff, covered in blossoms: paler toward white on top, deeper rose underneath and between puffs.
    // Lit in the tree's own frame, softly rather than in toon bands, which would outline every facet.
    vec3 nt = normalize(vLocalNormal);
    vec3 surface = vLocal;
    if (vPuff.z > 0.0) {
      // A far puff: trace its ellipsoid inside the proxy, for a round outline and smooth shading.
      // Over the proxy radius and with y unsquashed, the point's offset from the centre is its normal.
      vec3 o = vLocalNormal;
      float squash = o.y > 0.0 ? vPuff.x : vPuff.y;
      vec3 v = normalize(vec3(vViewT.x, vViewT.y / squash, vViewT.z));
      float miss = length(cross(o, v));
      if (miss > PROXY) discard;
      vec3 hit = o + v * (sqrt(PROXY * PROXY - miss * miss) - dot(o, v));
      surface = vLocal + vec3(1.0, squash, 1.0) * (hit - o) * vPuff.z;
      nt = normalize(vec3(hit.x, hit.y / squash, hit.z));
    }
    float sun = smoothstep(-0.35, 0.85, dot(nt, normalize(vSunT)));
    float under = smoothstep(0.15, -0.75, nt.y);
    float depth = clamp(0.55*vShade + 0.5*under + 0.35*(1.0-sun), 0.0, 1.0);
    vec3 gap = mix(vec3(0.78,0.40,0.56), vec3(0.55,0.27,0.43), depth);
    vec3 shaded = vec3(0.88,0.64,0.75);
    vec4 cluster = blots(petalCell * (PETAL / CLUSTER), clusterPrint, 1201u);
    // Far off, the blossoms' mean colour, mottled by clusters of them.
    vec3 body = mix(gap, blossomColour(vec4(1.0, 0.3, 0.1, 0.04), vTint, 0.0), 0.8);
    body = mix(body, mix(body, gap, 0.5), (1.0 - cluster.w) * 0.6);
    float cover = cluster.w;
    // Each blossom only while it spans a few pixels: tracing them is the crown's main cost.
    float detail = 1.0 - smoothstep(0.12, 0.25, flowerPrint);
    if (detail > 0.0) {
      // Near enough, each blossom; between them, deeper ones in shadow.
      vec4 look;
      vec4 bloom = puffBlossom(surface / FLOWER + vSeed * vec3(171.0, 83.0, 127.0), nt, normalize(vViewT), normalize(vSunT), flowerPrint, look);
      // A blossom's back shows no anthers and a deeper blush; its cupped petals catch the sun unevenly.
      bloom.w *= 1.0 - look.w;
      vec3 petals = blossomColour(bloom, look.x, 0.0) * mix(vec3(1.0), vec3(0.93,0.8,0.86), look.w);
      petals *= 0.8 + 0.26 * smoothstep(-0.4, 0.9, look.y);
      vec3 near = mix(gap, petals * mix(vec3(1.0), shaded, min(look.z, 1.0)), bloom.x);
      body = mix(body, near, detail);
      cover = mix(cover, bloom.x, detail);
    }
    // Toward its outline a puff breaks into its blossoms or, farther off, clusters of them.
    float rim = 1.0 - abs(dot(nt, normalize(vViewT)));
    if (cover < 0.5 * smoothstep(0.45, 0.8, rim) * (1.0 - smoothstep(0.45, 0.8, clusterPrint) * (1.0 - detail))) discard;
    body = mix(body, vec3(1.0,0.95,0.96), 0.15*sun*(1.0-depth));
    col = mix(body, body*shaded, depth*0.9);
    col = mix(vec3(0.32,0.50,0.16)*(0.85+0.15*light),col,vBloom);
  } else {
    col = mix(vec3(0.13,0.34,0.07),vec3(0.52,0.75,0.15),0.45*vTint+0.55*light);
  }
  col = applyAerial(col, length(cameraPosition-vWorld), vPlanet);
  gl_FragColor = vec4(col,1.0);
}
