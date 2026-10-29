import { ShaderChunk } from 'three';
import common from './common.glsl?raw';
import warp from './warp.glsl?raw';

// Shared GLSL lives in its own files and is registered as three.js shader
// chunks, so any ShaderMaterial can `#include <meadow_warp>` and friends.
const chunks: Record<string, string> = {
  meadow_common: common,
  meadow_warp: warp,
};

export function registerShaderChunks(): void {
  const registry = ShaderChunk as unknown as Record<string, string>;
  for (const [name, source] of Object.entries(chunks)) registry[name] = source;
}
