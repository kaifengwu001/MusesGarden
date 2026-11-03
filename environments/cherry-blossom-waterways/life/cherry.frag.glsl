#include <meadow_common>
#include <meadow_toon>
#include <meadow_fog>
#include <meadow_noise>
varying vec3 vNormal;
varying vec3 vPlanet;
varying vec3 vLocal;
varying vec3 vWorld;
varying float vKind;
varying float vTint;
varying float vBloom;
varying float vShade;
varying float vScale;

// Massed petals on a blossom cloud: two offset lattices of round blots, each
// its own pink or near-white, over a deeper rose between them. The same
// pattern makes the petals (PETAL m across) and the clusters they gather in
// (CLUSTER m), which still read where single petals are too small to see.
// `footprint` (lattice cells a pixel) fades a layer to its mean before it
// would shimmer.
const float PETAL = 0.18;
const float CLUSTER = 0.8;
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
  // Petal lattice in the tree's own meters; derivatives taken before any branch on the kind.
  vec3 petalCell = vLocal * vScale / PETAL;
  float footprint = length(fwidth(petalCell));
  float clusterPrint = footprint * PETAL / CLUSTER;
  vec3 col;
  if(vKind < 0.5) {
    float stroke = sin(vLocal.y*2.7 + sin(vLocal.x*11.0+vLocal.z*8.0)*1.8);
    col = mix(vec3(0.035,0.046,0.043),vec3(0.125,0.098,0.091),vTint*0.5+light*0.5);
    col += vec3(0.026,0.018,0.019)*smoothstep(0.55,0.85,stroke);
  } else if(vKind < 2.5) {
    vec3 pink = mix(vec3(0.91,0.34,0.51),vec3(1.0,0.65,0.73),vTint);
    vec3 cream = mix(vec3(1.0,0.77,0.76),vec3(1.0,0.96,0.88),vTint);
    col = (vKind > 1.5 ? cream : pink) * (0.8+light*0.2);
    col = mix(col,vec3(0.72,0.38,0.58),0.12*(1.0-light));
    col = mix(vec3(0.32,0.50,0.16)*(0.85+0.15*light),col,vBloom);
  } else if(vKind > 4.5) {
    // A blossom cloud: lit petals pale toward white on top, deeper rose underneath and between lobes.
    // Soft light rather than toon bands, which would outline every facet of the lobe.
    float sun = smoothstep(-0.35, 0.85, dot(n,uSunDir));
    float under = smoothstep(0.15, -0.75, n.y);
    float depth = clamp(0.55*vShade + 0.5*under + 0.35*(1.0-sun), 0.0, 1.0);
    vec3 gap = mix(vec3(0.86,0.47,0.63), vec3(0.62,0.32,0.48), depth);
    vec3 pink = mix(vec3(0.94,0.54,0.70), vec3(0.98,0.70,0.80), vTint);
    vec3 pale = vec3(1.0,0.93,0.94);
    vec3 shaded = vec3(0.88,0.64,0.75);
    vec4 cluster = blots(petalCell * (PETAL / CLUSTER), clusterPrint, 1201u);
    vec4 petal = blots(petalCell, footprint, 911u);
    // Toward its outline a lobe frays into separate petals or, farther off, clusters of them.
    float rim = 1.0 - abs(dot(n, normalize(cameraPosition - vWorld)));
    float cover = mix(petal.w, cluster.w, smoothstep(0.3, 0.7, footprint));
    if (cover < smoothstep(0.45, 0.8, rim) * (1.0 - smoothstep(0.45, 0.8, clusterPrint))) discard;
    // Clusters vary between deep pink and blush; sunlit tops bleach toward white.
    vec3 clusterCol = mix(pink, mix(pink, pale, 0.55), smoothstep(0.45, 0.9, cluster.x));
    clusterCol = mix(clusterCol, pale, 0.3*sun*(1.0-depth));
    vec3 body = mix(gap, clusterCol, mix(cluster.w, 0.75, smoothstep(0.35, 0.9, clusterPrint)));
    vec3 fleck = mix(clusterCol, pale, smoothstep(0.6, 0.95, petal.x));
    body = mix(body, fleck, petal.w * (1.0 - smoothstep(0.35, 0.9, footprint)) * 0.8);
    col = mix(body, body*shaded, depth*0.9);
    col = mix(vec3(0.32,0.50,0.16)*(0.85+0.15*light),col,vBloom);
  } else {
    col = mix(vec3(0.13,0.34,0.07),vec3(0.52,0.75,0.15),0.45*vTint+0.55*light);
  }
  col = applyAerial(col, length(cameraPosition-vWorld), vPlanet);
  gl_FragColor = vec4(col,1.0);
}
