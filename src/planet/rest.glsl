// GPU side of the growth fade band (rest.ts / GrowthBand).
// uGrowthBand = (hi, lo, 1/width) in ln R.
uniform vec3 uGrowthBand;

// ln of a point's birth radius for a class of density ρ: ½(ln σ_i − ln ρ).
float birthLnRadius(float lnThreshold, float lnDensity) {
  return 0.5 * (lnThreshold - lnDensity);
}

// 0 → not yet born, 1 → fully grown in; linear across the band.
float growthFade(float lnBirthRadius) {
  return clamp((uGrowthBand.x - lnBirthRadius) * uGrowthBand.z, 0.0, 1.0);
}
