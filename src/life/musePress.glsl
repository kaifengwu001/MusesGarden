// Muse lying in the grass (muse.ts): its body as a few spheres (planet space,
// m) that press the plants down round it and part them, a hollow where it
// lies, as long as it lies there (uMusePressK: how far it is lying, 0 … 1).
// Walking, sitting, it leaves them standing.
uniform vec4 uMusePress[6];
uniform float uMusePressK;

// How far a plant standing at base (up its stem by `tall`, m) is pressed down
// (0 … 1); its tip pushed away from the body, along the ground, into push.
float musePress(vec3 base, vec3 up, float tall, inout vec3 push) {
  if (uMusePressK <= 0.0 || distance(base, uMusePress[1].xyz) > 2.6) return 0.0;
  vec3 mid = base + up * (0.5 * tall);
  float pressed = 0.0;
  for (int i = 0; i < 6; i++) {
    vec4 c = uMusePress[i];
    vec3 d = mid - c.xyz;
    float k = 1.0 - smoothstep(0.55 * c.w, c.w + 0.15, length(d));
    vec3 away = d - up * dot(d, up);
    float l = length(away);
    if (l > 1e-4) push += away / l * (k * 1.6 * uMusePressK);
    pressed = max(pressed, k);
  }
  return pressed * uMusePressK;
}
