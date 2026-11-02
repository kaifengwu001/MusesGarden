// Still shallow mineral pools, with a local geometry mirror near the garden
// and the inexpensive sky/terrain reflection over the rest of the globe.
#define MAX_RIPPLES 6
uniform vec4 uWaterLook;
uniform vec4 uWaterSky;
uniform vec4 uRipples[MAX_RIPPLES];
uniform sampler2D uPoolMirror;
uniform mat4 uPoolMirrorMatrix;
uniform float uPoolMirrorStrength;
uniform vec3 uPoolMirrorCentre;
uniform vec4 uLanternLights[16];
uniform vec4 uWarpedLanternLights[16];
uniform int uLanternLightCount;
uniform float uLanternDusk;
uniform vec4 uPoolglassWakes[3];

// Thin broken rings around the animals anchor their bodies to the pool surface.
float poolglassWake(vec3 dir, vec3 along) {
  float wake = 0.0;
  for (int i=0;i<3;i++) {
    vec4 animal = uPoolglassWakes[i];
    if (animal.w <= 0.0) continue;
    vec3 delta = (dir-animal.xyz)*uRadius;
    float d=length(delta), spread=animal.w*1.65;
    float width=max(fwidth(d)*.7,.014);
    // Beyond twelve widths every exponential is below single-precision range.
    // Keep the derivative outside the rejection so quad derivatives stay valid.
    if (d > spread+1.88+12.0*width) continue;
    float phase=fract(uWaterLook.w*.22+float(i)*.31);
    float rings=0.0;
    for(int j=0;j<3;j++) {
      float radius=spread+.2+(float(j)+phase)*.42;
      float line=d-radius;
      rings+=exp(-line*line/(width*width))*(1.0-(float(j)+phase)/3.2);
    }
    float broken=.35+.65*smoothstep(-.5,.6,sin(dot(delta,along)*3.2+float(i)));
    wake+=rings*broken*smoothstep(0.0,.15,phase)*(1.0-smoothstep(.86,1.0,phase));
  }
  return clamp(wake,0.0,1.0);
}

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

vec3 waterSky(float e) {
  vec3 c = mix(pal(ROW_WATER, 4), pal(ROW_WATER, 0), smoothstep(0.0, 0.35, e));
  return mix(c, pal(ROW_WATER, 5), smoothstep(0.35, 0.9, e));
}

float bankTop(vec3 d) {
  float h = height0(d);
  return h + (uBank.x + uWaterSky.z) * smoothstep(0.0, 0.06, h);
}

float bankAlong(vec3 wp, vec3 r, float shore, float rise) {
  float t = 0.7 * shore;
  if (t * rise > uWaterSky.w) return 1e9;
  float dt = 0.08 + 0.05 * t;
  for (int i = 0; i < 13; i++) {
    float tn = t + dt;
    vec3 q = unwarpPosition(wp + r * tn);
    float len = length(q);
    if (len - uRadius > uWaterSky.w) break; // above anything the meadow reaches
    if (len - uRadius < bankTop(q / len)) {
      // refine the crossing between t and tn
      float lo = t;
      float hi = tn;
      for (int k = 0; k < 3; k++) {
        float mid = 0.5 * (lo + hi);
        vec3 m = unwarpPosition(wp + r * mid);
        float ml = length(m);
        if (ml - uRadius < bankTop(m / ml)) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    t = tn;
    dt *= 1.4;
  }
  return 1e9;
}

float glintOctave(vec3 dir, float freq, vec3 along, uint seed) {
  vec3 p = dir * freq;
  vec3 cell = floor(p);
  uint h = meadowHash(ivec3(cell), seed);
  float k = float((h >> 24) & 255u) / 255.0;
  if (k > 0.33) return 0.0;
  vec3 j = vec3(float(h & 255u), float((h >> 8) & 255u), float((h >> 16) & 255u)) / 255.0;
  vec3 d = p - (cell + 0.3 + 0.4 * j);
  float a = dot(d, along);
  float r = length(vec2(a * 0.38, length(d - along * a)));
  float life = 0.5 + 0.5 * sin(uWaterLook.w * (0.9 + 1.4 * j.y) + k * 40.0 + j.x * 6.2831853);
  return life * life * life * smoothstep(0.13, 0.04, r);
}

vec3 bankColour(vec3 d, float y) {
  float variation = textureLod(uTerrainBake, d, 0.0).a;
  vec3 mineral = mix(pal(ROW_ROCK, 1), pal(ROW_ROCK, 0), 0.2 + 0.3 * variation);
  return mix(mineral, pal(ROW_WATER, 1), 0.45) * (0.8 + 0.03 * clamp(y, 0.0, 2.0));
}

vec3 waterColour(vec3 dir, vec3 wp, float shore, float depth, float b, float cloud, float gust, float stroke, vec3 n, vec3 v, float pixelMeters) {
  vec3 along = windDir(dir);
  float facing = clamp(dot(n, v), 0.0, 1.0);
  vec3 body = mix(mix(pal(ROW_WATER, 1), pal(ROW_WATER, 0), 0.4), pal(ROW_WATER, 5), smoothstep(0.75, 0.08, depth) * 0.45 * uWaterLook.y);
  vec3 r0 = reflect(-v, n);
  vec3 r = normalize(r0 + along * stroke * 0.018 * (0.2 + gust) * uWindVec.w);
  float rise = dot(r, n);
  vec3 mirror = waterSky(rise);
  float tBank = bankAlong(wp, r, -shore, rise / sqrt(max(1.0 - rise * rise, 1e-4)));
  bool bank = tBank < 1e8;
  vec4 cl = vec4(0.0);
  if (bank) {
    vec3 q = unwarpPosition(wp + r * tBank);
    float ql = length(q);
    mirror = bankColour(q / ql, ql - uRadius);
  } else {
    if (uCloudOrbit.x < 1.0) cl = cloudsInMirror(wp, r, r0, gl_FragCoord.xy / uResolution);
    if (uCloudOrbit.x > 0.0) cl = mix(cl, cloudsFromOrbit(wp, r), uCloudOrbit.x);
  }
  float reflection = mix(0.46, 0.88, pow(1.0 - facing, 1.8)) * uWaterSky.x;
  vec3 col = mix(body, mirror, reflection);
  if (bank) col = mix(col, mirror, 0.35 * uWaterSky.x);
  col = mix(col, cl.rgb / max(cl.a, 1e-3), cl.a * 0.65 * uWaterSky.x);
  // Reflect the actual reeds, rocks, shelter and animals through the local basin plane.
  float wavePhase=dot(dir,along)*uRadius;
  if (uPoolMirrorStrength > 0.0) {
  vec4 reflected = uPoolMirrorMatrix * vec4(wp, 1.0);
  vec2 uv = reflected.xy / reflected.w;
  float inView = step(0.0,uv.x)*step(uv.x,1.0)*step(0.0,uv.y)*step(uv.y,1.0)*step(0.0,reflected.w);
  vec2 rippleOffset=vec2(sin(wavePhase*4.5+uWaterLook.w*.35)*.0028+sin(wavePhase*13.0-uWaterLook.w*.24)*.0012,sin(wavePhase*7.0-uWaterLook.w*.3)*.0007);
  vec4 objects=texture2D(uPoolMirror,clamp(uv+rippleOffset,0.001,0.999));
  vec3 reflectedObjects=objects.rgb/max(objects.a,0.001);
  float reflectionRipple=.85+.15*sin(wavePhase*10.0+uWaterLook.w*.35);
  float basinMirror=1.0-smoothstep(24.0,42.0,length(dir-uPoolMirrorCentre)*uRadius);
  col=mix(col,reflectedObjects,objects.a*inView*uPoolMirrorStrength*basinMirror*mix(0.42,0.73,pow(1.0-facing,0.8))*reflectionRipple);
  }

  // Warm, fragmented vertical light paths are tied to real seed lantern positions.
  if (uLanternDusk > 0.0) {
  vec3 reflectedRay=r0;
  float rayHeight=dot(reflectedRay,n);
  vec3 horizontalRay=normalize(reflectedRay-n*rayHeight);
  float bands=0.25+0.75*smoothstep(-0.3,0.8,sin(wavePhase*13.0+uWaterLook.w*0.45)+0.25*sin(wavePhase*31.0));
  for(int i=0;i<16;i++) {
    if(i>=uLanternLightCount) break;
    vec3 lamp=uWarpedLanternLights[i].xyz;
    vec3 delta=lamp-wp;
    vec3 toLamp=normalize(delta);
    float vertical=rayHeight-dot(toLamp,n);
    vec3 horizontalLamp=normalize(toLamp-n*dot(toLamp,n));
    float across=length(horizontalRay-horizontalLamp);
    float spread=0.014+0.016/(1.0+length(delta)*0.04);
    float path=exp(-across*across/(spread*spread)-vertical*vertical/0.022);
    col+=vec3(1.0,0.57,0.19)*path*bands*uLanternLights[i].w*uLanternDusk*0.58;
  }
  }
  col = mix(col, pal(ROW_WATER, 9), smoothstep(0.42, 0.85, stroke) * 0.07 * uWindVec.w);
  // Sparse elongated ripples carry a little sky colour across the quiet basin.
  vec3 waveDir = normalize(dir + along * (0.08 * sin(uWaterLook.w * 0.16) / uRadius));
  float wave = strokes(waveDir, uRadius / 4.0, along, uTerrainSeed + 148u);
  float ribbon = 1.0 - smoothstep(0.035, 0.085, abs(wave - 0.15));
  float broken = smoothstep(-0.05, 0.25, gnoise(dir * (uRadius / 11.0), uTerrainSeed + 149u));
  col = mix(col, pal(ROW_WATER, 9), ribbon * broken * 0.3 * (1.0 - cloud) * (1.0 - smoothstep(0.15, 0.7, pixelMeters)));
  float f0, f1;
  uint lv;
  float t = patternOctaves(0.8, pixelMeters, 8.0, f0, f1, lv);
  float sparkle = mix(glintOctave(dir, f0, along, uTerrainSeed + 130u + lv), glintOctave(dir, f1, along, uTerrainSeed + 131u + lv), t);
  col += pal(ROW_WATER, 3) * sparkle * 0.15 * uWaterLook.z * (1.0 - cloud);
  col = mix(col, pal(ROW_WATER, 3), clamp(rippleRing(dir), 0.0, 1.0) * 0.38);
  col = mix(col, mix(pal(ROW_WATER,9),pal(ROW_WATER,3),.35), poolglassWake(dir,along)*.62);
  // A thin pale wet edge emphasizes the common waterline without foamy surf.
  float edge = smoothstep(-0.42, -0.06, shore) * (1.0 - smoothstep(0.025, 0.15, pixelMeters));
  col = mix(col, mix(pal(ROW_WATER, 9), pal(ROW_WATER, 3), 0.25), edge * 0.2);
  return col * (1.0 - 0.12 * cloud * (1.0 - reflection));
}
