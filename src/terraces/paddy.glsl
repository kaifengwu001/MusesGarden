// A paddy's crop this season (ARCHITECTURE.md, "Each paddy's infill"): how
// far through the season it is (its cell's season, and a chance of its own,
// so neighbouring paddies differ and whole cells lean earlier or later), or
// left fallow; its plants' height (each paddy its own: a hand high as
// seedlings, waist high grown); the water standing on its floor (brimming
// when just flooded, lower as the crop grows, drained as it ripens, each
// paddy to its own level); its own shade of green. GPU mirror of cropOf in
// plots.ts. Requires: terraces_plots.

uniform vec4 uPaddy; // -, the season's front, the cell's share of a paddy's delay, -

const float PADDY_SEASON_SPREAD = 0.42;
const float PADDY_FALLOW = 0.05;

struct Crop {
  float variant;  // 0..1, its colour
  float maturity; // 0 flooded … 1 ripe
  float fallow;   // 1: left fallow this season
  float height;   // its plants' height (m)
  float water;    // the water's depth over its floor (m)
  float rows;     // 0..1, its rows' turn
};

Crop cropOf(Plot p) {
  Crop c;
  c.variant = unitHash(p.id);
  c.rows = unitHash(nextHash(p.id));
  float chance = unitHash(p.id ^ 0x9e3779b9u);
  float delay = clamp(uPaddy.z * p.season + (1.0 - uPaddy.z) * chance, 0.0, 1.0);
  c.maturity = clamp((uPaddy.y - delay) / PADDY_SEASON_SPREAD, 0.0, 1.0);
  c.fallow = step(unitHash(p.id ^ 0x85ebca6bu), PADDY_FALLOW);
  float hv = unitHash(p.id ^ 0x632be5abu);
  c.height = c.maturity > 0.0 && c.fallow < 0.5 ? mix(0.12, 0.95, smoothstep(0.05, 0.85, c.maturity)) * (0.8 + 0.4 * hv) : 0.0;
  float wv = unitHash(p.id ^ 0x2545f491u);
  float full = mix(0.06, 0.16, wv);
  c.water = c.fallow > 0.5 ? (wv < 0.3 ? 0.025 : 0.0) : full * (1.0 - smoothstep(0.55, 0.95, c.maturity)) * mix(1.0, 0.45, smoothstep(0.05, 0.5, c.maturity) * hv);
  return c;
}
