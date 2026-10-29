import { ShaderChunk } from 'three';
import cloudShadow from '../life/cloudShadow.glsl?raw';
import field from '../life/field.glsl?raw';
import wind from '../life/wind.glsl?raw';
import cubesphere from '../planet/cubesphere.glsl?raw';
import meadow from '../planet/meadow.glsl?raw';
import noise from '../planet/noise.glsl?raw';
import rest from '../planet/rest.glsl?raw';
import terrain from '../planet/terrain.glsl?raw';
import water from '../planet/water.glsl?raw';
import common from './common.glsl?raw';
import fog from './fog.glsl?raw';
import toon from './toon.glsl?raw';
import warp from './warp.glsl?raw';

// Shared GLSL lives in its own files and is registered as three.js shader
// chunks, so any ShaderMaterial can `#include <meadow_warp>` and friends.
const chunks: Record<string, string> = {
  meadow_common: common,
  meadow_noise: noise,
  meadow_cubesphere: cubesphere,
  meadow_warp: warp,
  meadow_rest: rest,
  meadow_terrain: terrain,
  meadow_toon: toon,
  meadow_fog: fog,
  meadow_paint: meadow,
  meadow_water: water,
  meadow_clouds_shadow: cloudShadow,
  meadow_field: field,
  meadow_wind: wind,
};

export function registerShaderChunks(): void {
  const registry = ShaderChunk as unknown as Record<string, string>;
  for (const [name, source] of Object.entries(chunks)) registry[name] = source;
}
