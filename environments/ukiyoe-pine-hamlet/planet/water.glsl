// Ukiyo-e water: broad blue pigment, reflected banks, and connected horizontal
// light shapes. All marks are painted into the one physical water surface;
// there are no coplanar ripple cards. Reflection samples the actual terrain.
#define MAX_RIPPLES 6
uniform vec4 uWaterLook;             // -, depth tint, glints, time (s)
uniform vec4 uWaterSky;              // reflection strength, lily pads, grass height in the mirror (m), highest meadow (m)
uniform vec4 uRipples[MAX_RIPPLES];  // centre direction, start time (s); w < 0 = unused

float rippleRing(vec3 dir) {
  float acc = 0.0;
  for (int i = 0; i < MAX_RIPPLES; i++) {
    vec4 r = uRipples[i];
    if (r.w < 0.0) continue;
    float age = uWaterLook.w - r.w;
    if (age < 0.0 || age > 4.0) continue;
    float d = chordAngle(dir, r.xyz) * uRadius;
    float ring = d - age * 1.6;
    float wave = exp(-ring * ring / 0.02) + 0.6 * exp(-(ring + 0.5) * (ring + 0.5) / 0.02);
    acc += wave * (1.0 - age / 4.0) * smoothstep(0.0, 0.3, age);
  }
  return acc;
}

float waterWash(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + 1.0), f.x), f.y);
}

float bankReflection(vec3 point, vec3 ray) {
  float bank = 0.0;
  // Low broad banks are reflected as one ink mass; the changing row displacement
  // below cuts its edge into water-shaped pieces instead of tiled white dashes.
  for (int i = 1; i <= 9; i++) {
    float distanceAlong = 0.5 + float(i * i) * 0.7;
    vec3 samplePoint = unwarpPosition(point + ray * distanceAlong);
    float ground = height0(normalize(samplePoint));
    float clearance = length(samplePoint) - uRadius - ground;
    float hit = (1.0 - smoothstep(-0.08, 0.22, clearance)) * smoothstep(0.0, 0.4, ground);
    bank = max(bank, hit);
  }
  return bank;
}

vec3 waterColour(vec3 dir, vec3 wp, float shore, float depth, float b, float cloud, float gust, float stroke, vec3 n, vec3 v, float pixelMeters) {
  float facing = clamp(dot(n, v), 0.0, 1.0);
  vec2 c = cottageLocal(dir);
  // Long joined shapes with unequal widths, borrowed from printed reflections.
  // A slow continuous displacement preserves the identity of each shape.
  float drift = sin(c.y * 0.68 + uWaterLook.w * 0.14) * 0.13;
  vec2 field = vec2(c.x * 0.66 + drift, c.y * 3.5 + 0.18 * sin(c.x * 1.3));
  float wash = waterWash(field + vec2(19.7, 3.2));
  wash += (waterWash(field * vec2(2.7, 1.5) + 40.1) - 0.5) * 0.30;
  float aa = clamp(pixelMeters * 0.60, 0.008, 0.22);
  float shapes = smoothstep(0.67 - aa, 0.70 + aa, wash);
  float fineEdge = smoothstep(0.64 - aa, 0.65 + aa, wash) - shapes;
  float resolved = 1.0 - smoothstep(0.5, 2.0, pixelMeters);
  float broad = waterWash(c * vec2(0.07, 0.12) + 83.4);
  vec3 col = mix(pal(ROW_WATER, 0), pal(ROW_WATER, 1), 0.20 + facing * 0.20 + broad * 0.13);
  col = mix(col, pal(ROW_WATER, 4), (1.0 - facing) * 0.16);
  vec3 normal = normalize(n + (v - dot(v, n) * n) * ((wash - 0.5) * 0.018));
  vec3 reflected = reflect(-v, normal);
  float reflection = bankReflection(wp + n * 0.035, reflected);
  col = mix(col, pal(ROW_WATER, 8), reflection * 0.65);
  // The unbroken middle-distance blue is as important as the few light shapes.
  float openReflection = smoothstep(0.25, 0.65, broad);
  float patchStrength = resolved * mix(0.22, 0.58, facing) * (0.30 + 0.70 * openReflection);
  col = mix(col, pal(ROW_WATER, 9), shapes * patchStrength);
  col = mix(col, pal(ROW_WATER, 5), max(fineEdge, 0.0) * resolved * 0.16);
  col = mix(col, pal(ROW_WATER, 8), (1.0 - smoothstep(0.0, 0.5, depth)) * 0.22);
  col = mix(col, pal(ROW_WATER, 3), clamp(rippleRing(dir), 0.0, 1.0) * 0.45);
  return col * (1.0 - cloud * 0.06);
}
