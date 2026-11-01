import { ShaderChunk } from 'three';
import cloudLumps from '../../../src/life/cloudLumps.glsl?raw';
import clouds from '../../../src/life/clouds.glsl?raw';
import field from '../../../src/life/field.glsl?raw';
import find from '../../../src/life/findForm.glsl?raw';
import musePress from '../../../src/life/musePress.glsl?raw';
import wind from '../../../src/life/wind.glsl?raw';
import cubesphere from '../../../src/planet/cubesphere.glsl?raw';
import fields from '../planet/fields.glsl?raw';
import meadow from '../planet/meadow.glsl?raw';
import noise from '../../../src/planet/noise.glsl?raw';
import rest from '../../../src/planet/rest.glsl?raw';
import terrain from '../planet/terrain.glsl?raw';
import water from '../planet/water.glsl?raw';
import common from '../../../src/render/common.glsl?raw';
import fog from '../../../src/render/fog.glsl?raw';
import sun from '../../../src/render/sun.glsl?raw';
import toon from './toon.glsl?raw';
import warp from '../../../src/render/warp.glsl?raw';

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
};

export function registerShaderChunks(): void {
  const registry = ShaderChunk as unknown as Record<string, string>;
  for (const [name, source] of Object.entries(chunks)) registry[name] = source;
}
