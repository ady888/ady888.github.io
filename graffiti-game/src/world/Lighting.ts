import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { GlowLayer } from "@babylonjs/core/Layers/glowLayer";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Mesh } from "@babylonjs/core/Meshes/mesh";

import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";

export interface LightingRig {
  moon: DirectionalLight;
  ambient: HemisphericLight;
  shadows: ShadowGenerator | null;
  glow: GlowLayer;
}

/**
 * Night-time alley lighting.
 *
 * One cold directional "moon" for shape, a warm bounce hemisphere so the ground
 * is never pure black, exponential fog for depth, and a glow layer that makes
 * the neon and lamp bulbs bleed. Individual lamps add their own point lights.
 */
export function setupLighting(scene: Scene, quality: "high" | "low" = "high"): LightingRig {
  scene.clearColor = new Color4(0.043, 0.05, 0.07, 1);
  scene.ambientColor = new Color3(0.2, 0.21, 0.27);

  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogColor = new Color3(0.07, 0.08, 0.11);
  scene.fogDensity = 0.0125;

  const ambient = new HemisphericLight("light.ambient", new Vector3(0.2, 1, 0.1), scene);
  ambient.diffuse = new Color3(0.42, 0.47, 0.62);
  ambient.groundColor = new Color3(0.14, 0.13, 0.17);
  ambient.specular = new Color3(0.1, 0.1, 0.12);
  ambient.intensity = 0.8;

  const moon = new DirectionalLight("light.moon", new Vector3(-0.45, -1, 0.32), scene);
  moon.position = new Vector3(30, 46, -30);
  moon.diffuse = new Color3(0.58, 0.66, 0.9);
  moon.specular = new Color3(0.3, 0.34, 0.45);
  moon.intensity = 0.95;

  let shadows: ShadowGenerator | null = null;
  if (quality === "high") {
    shadows = new ShadowGenerator(1024, moon);
    shadows.useExponentialShadowMap = true;
    shadows.darkness = 0.42;
    shadows.bias = 0.0018;
    shadows.normalBias = 0.02;
    // Shadow casters are only worth rendering near the player.
    moon.shadowMinZ = 1;
    moon.shadowMaxZ = 90;
  }

  const glow = new GlowLayer("glow", scene, { blurKernelSize: 32 });
  glow.intensity = 0.55;

  return { moon, ambient, shadows, glow };
}

export function registerShadowCasters(rig: LightingRig, meshes: Mesh[]): void {
  if (!rig.shadows) return;
  const map = rig.shadows.getShadowMap();
  if (!map) return;
  for (const mesh of meshes) map.renderList?.push(mesh);
}
