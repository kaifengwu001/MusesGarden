import { ShaderChunk } from 'three';
import cloudLumps from '../life/cloudLumps.glsl?raw';
import clouds from '../life/clouds.glsl?raw';
import field from '../life/field.glsl?raw';
import find from '../life/findState.glsl?raw';
import musePress from '../life/musePress.glsl?raw';
import museShadow from '../life/museShadowMap.glsl?raw';
import occlude from '../life/occlude.glsl?raw';
import wind from '../life/wind.glsl?raw';
import cubesphere from '../planet/cubesphere.glsl?raw';
import fields from '../planet/fields.glsl?raw';
import meadow from '../planet/meadow.glsl?raw';
import noise from '../planet/noise.glsl?raw';
import rest from '../planet/rest.glsl?raw';
import terrain from '../planet/terrain.glsl?raw';
import water from '../planet/water.glsl?raw';
import common from './common.glsl?raw';
import fog from './fog.glsl?raw';
import sun from './sun.glsl?raw';
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
  meadow_fields: fields,
  meadow_toon: toon,
  meadow_fog: fog,
  meadow_sun: sun,
  meadow_paint: meadow,
  meadow_water: water,
  meadow_cloud_lumps: cloudLumps,
  meadow_clouds: clouds,
  meadow_field: field,
  meadow_wind: wind,
  meadow_find: find,
  meadow_muse_press: musePress,
  meadow_muse_shadow: museShadow,
  meadow_occlude: occlude,
};

export function registerShaderChunks(): void {
  const registry = ShaderChunk as unknown as Record<string, string>;
  for (const [name, source] of Object.entries(chunks)) registry[name] = source;
}
