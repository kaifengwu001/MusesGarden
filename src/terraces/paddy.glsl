// A paddy's crop this season: how far through the season it is (its place
// in it, from the build: a slow noise over the hillsides and now and then
// one of its own, build/construct.ts), or left fallow; its plants' height
// (each paddy its own: a hand high as seedlings, waist high grown); the
// water standing on its floor (brimming when just flooded, lower as the crop
// grows, drained as it ripens, each paddy to its own level); its own shade
// of green.

uniform vec4 uPaddy; // -, the season's front, -, -

const float PADDY_SEASON_SPREAD = 0.42;

struct Crop {
  float variant;  // 0..1, its colour
  float maturity; // 0 flooded … 1 ripe
  float fallow;   // 1: left fallow this season
  float height;   // its plants' height (m)
  float water;    // the water's depth over its floor (m)
  float rows;     // 0..1, its rows' turn
};

// A paddy's crop at the season's front from its constants (the built terraces carry them, aPaddy): its colour,
// its place in the season, its plants' and its water's own share, fallow.
Crop cropFrom(float variant, float delay, float hv, float wv, float fallow) {
  Crop c;
  c.variant = variant;
  c.rows = 0.0;
  c.maturity = clamp((uPaddy.y - delay) / PADDY_SEASON_SPREAD, 0.0, 1.0);
  c.fallow = fallow;
  c.height = c.maturity > 0.0 && fallow < 0.5 ? mix(0.12, 0.95, smoothstep(0.05, 0.85, c.maturity)) * (0.8 + 0.4 * hv) : 0.0;
  float full = mix(0.06, 0.16, wv);
  c.water = fallow > 0.5 ? (wv < 0.3 ? 0.025 : 0.0) : full * (1.0 - smoothstep(0.55, 0.95, c.maturity)) * mix(1.0, 0.45, smoothstep(0.05, 0.5, c.maturity) * hv);
  return c;
}
