// Golden Rye's fields, baked into a cube map (bake.ts, pass 2) that the
// ground paint, the standing crop and the detailed ears all read:
//   r  crop depth (m): how far inside its field's standing crop a point is;
//      negative on bunds, roads and yards
//   g  the field's tone in [0, 1): which crop it grows (crop.glsl cropKind)
//   b  road (m): distance outside the road's edge, negative on the road
//   a  cut: 1 where the crop is reaped to stubble round a sheaf
// Then tiny leftover pieces of crop (a field's end cut off by the drive, a
// sliver between the yard and a road) are taken out: pass 3 measures how
// much of a disk round each point its own field covers, pass 4 keeps a
// piece only if the largest such measure near it reaches PARCELS.leastArea.
// After Ryo Takemasa's terraces (Kai's reference): long strips of crop that
// follow one another like contour lines, each strip broken into segments
// with rounded ends, olive bunds of uneven width between them. The strips are
// bands of a latitude about the grain axis, bent and wavering, so their
// widths vary; each band is cut along its length at uneven intervals. The
// bands' axis is the cottage's front, so round the home the strips run
// parallel to its facade (the bends and waver fade in away from it). The
// farm road is one of the bands' own borders, passing in front of the
// cottage (so the fields run alongside it, as in the farm map reference); a
// side road crosses the bands beside it, where the strips end; a drive runs
// from the porch steps straight out to the road. Distances are meters,
// measured by finite differences, so warps keep bunds and roads an even width.
// Requires: meadow_noise, meadow_fields (uGrain, uFieldSeed).

#define PARCEL_YARDS 32
#define PARCEL_TAU 6.28318530718
// how far the strips meander at about 60 m: like contours over gentle slopes, not loops
#define PARCEL_MEANDER 1.3
uniform float uParcelRadius;  // planet radius (m)
uniform vec4 uParcelShape;    // band period (rad), band waver (bands), mean segment length (m), bund half width (m)
uniform vec4 uParcelEdge;     // corner rounding (m), -, road half width (m), verge (m)
uniform vec4 uParcelHome;     // the cottage's direction, how far the roads pass from it (m)
uniform vec4 uParcelFront;    // the way the cottage faces (unit tangent there): the bands' axis
uniform vec4 uParcelYards[PARCEL_YARDS]; // direction, radius (m): + a grass yard, - reaped stubble round a sheaf
uniform int uParcelYardCount;
uniform vec4 uParcelPatch;           // disk radius (m), least share of it a piece must cover, -, -
uniform samplerCube uBakedParcels;   // pass 3 reads the fields pass 2 wrote
uniform samplerCube uBakedArea;      // pass 4 reads what pass 3 measured

float parcelHash(float a, float b, uint salt) {
  uint h = meadowHash(ivec3(int(a), int(b), 17), uFieldSeed + salt);
  return float(h >> 8) / 16777216.0;
}

float parcelHomeDistance(vec3 dir) {
  return 2.0 * asin(clamp(0.5 * length(dir - uParcelHome.xyz), 0.0, 1.0)) * uParcelRadius;
}

// The point the bands are laid out on: gently bent, broad then finer, less so
// round the home. (Not the terrain's twirls: their shear would cross the side
// road and the strips' ends at a slant to the strips.)
vec3 parcelSpace(vec3 dir) {
  vec3 broad = vec3(gnoise(dir * 1.3, uFieldSeed + 901u), gnoise(dir * 1.3, uFieldSeed + 902u), gnoise(dir * 1.3, uFieldSeed + 903u));
  vec3 fine = vec3(gnoise(dir * 3.4, uFieldSeed + 906u), gnoise(dir * 3.4, uFieldSeed + 907u), gnoise(dir * 3.4, uFieldSeed + 908u));
  float away = smoothstep(20.0, 60.0, parcelHomeDistance(dir));
  return normalize(dir + (broad * 0.16 + fine * 0.035) * away);
}

// x: the band coordinate (bands, continuous), y: longitude about the bands' axis (rad).
vec2 parcelCoords(vec3 dir) {
  vec3 q = parcelSpace(dir);
  vec3 axis = uParcelFront.xyz;
  vec3 e1 = normalize(cross(axis, abs(axis.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 e2 = cross(axis, e1);
  float lat = asin(clamp(dot(q, axis), -1.0, 1.0));
  float waver = uParcelShape.y * smoothstep(16.0, 45.0, parcelHomeDistance(dir));
  float band = lat / uParcelShape.x + waver * (gnoise(q * 5.0, uFieldSeed + 904u) + PARCEL_MEANDER * gnoise(q * 10.5, uFieldSeed + 905u));
  return vec2(band, atan(dot(q, e2), dot(q, e1)));
}

float wrapAngle(float a) {
  return atan(sin(a), cos(a));
}

// Rounded minimum (polynomial): the corner where a strip's side meets its end.
float parcelRound(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

vec4 parcelBake(vec3 dir) {
  vec3 t1 = normalize(cross(dir, abs(dir.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(dir, t1);
  const float STEP = 0.12; // m
  vec2 c0 = parcelCoords(dir);
  vec2 c1 = parcelCoords(normalize(dir + t1 * (STEP / uParcelRadius)));
  vec2 c2 = parcelCoords(normalize(dir + t2 * (STEP / uParcelRadius)));
  // the farm road passes in front of the cottage, the side road beside it, both uParcelHome.w away
  vec3 home = uParcelHome.xyz;
  vec3 front = uParcelFront.xyz;
  vec3 right = normalize(cross(home, front));
  float reach = uParcelHome.w / uParcelRadius;
  vec2 at = vec2(parcelCoords(normalize(home * cos(reach) + front * sin(reach))).x,
                 parcelCoords(normalize(home * cos(reach) + right * sin(reach))).y);

  // the bands, counted from the farm road's (band 0's lower border)
  float f = c0.x - at.x;
  float fGrad = length(vec2(c1.x - c0.x, c2.x - c0.x)) / STEP; // bands per m
  float band = floor(f);
  float v = f - band;
  float bund = uParcelShape.w;
  float lower = v / fGrad - bund * mix(0.75, 1.7, parcelHash(band, 0.0, 911u));
  float upper = (1.0 - v) / fGrad - bund * mix(0.75, 1.7, parcelHash(band + 1.0, 0.0, 911u));
  float side = min(lower, upper);

  // segments along the band: a whole number round it, unevenly spaced, the side road always a cut
  vec2 gf = vec2(c1.x - c0.x, c2.x - c0.x) / STEP; // ∇f (bands per m, in the t1, t2 frame)
  vec2 gl = vec2(wrapAngle(c1.y - c0.y), wrapAngle(c2.y - c0.y)) / STEP; // ∇longitude (rad per m)
  float lon = wrapAngle(c0.y - at.y);
  // the band's own circumference (m) at its middle, so a band keeps one count of segments
  float around = PARCEL_TAU * uParcelRadius * cos(clamp((band + 0.5 + at.x) * uParcelShape.x, -1.55, 1.55));
  float length_ = uParcelShape.z * mix(0.45, 2.2, parcelHash(band, 1.0, 912u));
  float n = max(1.0, floor(around / length_ + 0.5));
  float m = max(1.0, floor(n / 3.0 + 0.5));
  float phase = PARCEL_TAU * parcelHash(band, 2.0, 913u);
  float x = (lon < 0.0 ? lon + PARCEL_TAU : lon) / PARCEL_TAU;
  float k = 0.32 * n / (PARCEL_TAU * m);
  float u = n * x + k * (sin(PARCEL_TAU * m * x + phase) - sin(phase));
  vec2 gu = gl * (n + k * PARCEL_TAU * m * cos(PARCEL_TAU * m * x + phase)) / PARCEL_TAU; // ∇u (segments per m)
  float segment = floor(u);
  float w = u - segment;
  // A cut is a meridian, which crosses a wavering band at a slant. Measure
  // the distance along the band from where the cut crosses its middle
  // instead, so every strip ends square to itself (then rounded).
  vec2 along = normalize(vec2(-gf.y, gf.x));
  along *= sign(dot(along, gu) + 1e-9);
  float det = gf.x * gu.y - gf.y * gu.x;
  float gapLow = bund * mix(0.8, 3.2, parcelHash(band, mod(segment, n), 914u));
  float gapHigh = bund * mix(0.8, 3.2, parcelHash(band, mod(segment + 1.0, n), 914u));
  float aLow, aHigh; // signed distances along the band past the lower and short of the upper cut (m)
  if (abs(det) > 1e-7) {
    mat2 inv = mat2(gu.y, -gu.x, -gf.y, gf.x) / det; // inverse of the rows (gf, gu)
    aLow = dot(inv * vec2(v - 0.5, w), along);
    aHigh = -dot(inv * vec2(v - 0.5, w - 1.0), along);
  } else {
    float uGrad = max(length(gu), 1e-6);
    aLow = w / uGrad;
    aHigh = (1.0 - w) / uGrad;
  }
  // a point the squared cut leaves on the far side belongs to that segment
  if (aLow < 0.0) segment -= 1.0;
  else if (aHigh < 0.0) segment += 1.0;
  float ends = min(abs(aLow) - gapLow, abs(aHigh) - gapHigh);
  float field = parcelRound(side, ends, uParcelEdge.x);

  // the roads: the farm road along band 0's border, the side road across the bands
  float alongRoad = abs(f) / max(fGrad, 1e-6);
  float acrossRoad = abs(lon) / max(length(gl), 1e-6);
  float road = min(alongRoad, acrossRoad) - uParcelEdge.z;
  // the drive: from the porch steps (cottage-local x 1.9–3.9 m, front at z 5.85)
  // straight out to the farm road's middle, on the cottage's side of it
  vec3 off = dir - home;
  vec2 local = vec2(dot(off, right), dot(off, front)) * uParcelRadius;
  float homeSide = sign(parcelCoords(home).x - at.x);
  float drive = max(abs(local.x - 2.9) - 1.15, 5.7 - local.y);
  bool nearHome = dot(dir, home) > 0.5; // (the same slab of the sphere also lies round the far pole)
  if (sign(f) != homeSide || !nearHome) drive = max(drive, 1e3);
  road = min(road, drive);
  float depth = parcelRound(field, road - uParcelEdge.w, uParcelEdge.x);

  float cut = 0.0;
  for (int i = 0; i < PARCEL_YARDS; i++) {
    if (i >= uParcelYardCount) break;
    vec4 y = uParcelYards[i];
    float d = 2.0 * asin(clamp(0.5 * length(dir - y.xyz), 0.0, 1.0)) * uParcelRadius;
    float wobble = 0.9 * gnoise(dir * (uParcelRadius / 3.0), uFieldSeed + 930u + uint(i));
    if (y.w > 0.0) depth = min(depth, d + wobble - y.w);
    else cut = max(cut, smoothstep(-y.w + 0.35, -y.w - 0.35, d + wobble));
  }
  float tone = parcelHash(band, mod(segment + n, n), 915u);
  // the drive cuts the fields it crosses: the piece between it and the side
  // road is a field of its own (its own crop, and measured on its own)
  float porchBand = floor(parcelCoords(normalize(home + front * (5.85 / uParcelRadius))).x - at.x);
  if (nearHome && sign(f) == homeSide && band >= porchBand && local.x > 2.9 && local.x < uParcelHome.w + 3.0) tone = fract(tone + 0.5);
  return vec4(depth, tone, road, cut);
}

// The i-th of n points spread evenly over a disk of `radius` (m) round dir.
vec3 parcelDisk(vec3 dir, vec3 t1, vec3 t2, int i, int n, float radius) {
  float r = radius * sqrt((float(i) + 0.5) / float(n));
  float a = float(i) * 2.39996323;
  return normalize(dir + (t1 * cos(a) + t2 * sin(a)) * (r / uParcelRadius));
}

bool parcelSame(vec4 a, vec4 b) {
  // (tones come through half floats: within one step of them)
  return b.x > 0.0 && abs(a.y - b.y) < 6e-4;
}

// pass 3: r the share of the disk round dir its own field's crop covers, g its tone, b its crop depth.
vec4 parcelAreaBake(vec3 dir) {
  vec4 p = textureLod(uBakedParcels, dir, 0.0);
  if (p.x <= 0.0) return vec4(0.0, p.y, p.x, 0.0);
  vec3 t1 = normalize(cross(dir, abs(dir.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(dir, t1);
  const int N = 64;
  float same = 0.0;
  for (int i = 0; i < N; i++) {
    if (parcelSame(p, textureLod(uBakedParcels, parcelDisk(dir, t1, t2, i, N, uParcelPatch.x), 0.0))) same += 1.0;
  }
  return vec4(same / float(N), p.y, p.x, 0.0);
}

// pass 4: the fields again, with each piece of crop whose field nowhere near
// it covers the least share of a disk turned to grass. (A small piece lies
// inside the disk round its middle, so there the share is its whole area.)
vec4 parcelFinalBake(vec3 dir) {
  vec4 p = parcelBake(dir);
  if (p.x <= 0.0) return p;
  vec3 t1 = normalize(cross(dir, abs(dir.y) < 0.95 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
  vec3 t2 = cross(dir, t1);
  vec4 own = vec4(p.x, p.y, 0.0, 0.0);
  vec4 here = textureLod(uBakedArea, dir, 0.0);
  float best = parcelSame(own, here.bgra) ? here.r : 0.0;
  const int N = 40;
  for (int i = 0; i < N; i++) {
    vec4 s = textureLod(uBakedArea, parcelDisk(dir, t1, t2, i, N, uParcelPatch.x), 0.0);
    if (parcelSame(own, s.bgra)) best = max(best, s.r);
  }
  if (best < uParcelPatch.y) p.x = -1.0;
  return p;
}
