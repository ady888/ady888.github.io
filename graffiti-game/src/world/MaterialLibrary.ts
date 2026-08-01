import { Color3 } from "@babylonjs/core/Maths/math.color";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";

import {
  asphaltTexture,
  brickTexture,
  chainLinkTexture,
  concreteTexture,
  metalTexture,
  puddleTexture,
  shutterTexture,
  signTexture,
} from "./ProceduralTextures";

export type MaterialId =
  | "brickWarm"
  | "brickCold"
  | "concrete"
  | "concreteDark"
  | "asphalt"
  | "shutter"
  | "shutterBlue"
  | "metal"
  | "metalDark"
  | "chainLink"
  | "puddle"
  | "glassDark"
  | "wood"
  | "trim";

/**
 * Central material cache.
 *
 * Materials are created lazily and shared by every mesh that asks for them, so
 * the whole district runs on roughly a dozen shader compilations regardless of
 * how many props we scatter around.
 */
export class MaterialLibrary {
  private readonly cache = new Map<string, StandardMaterial>();

  constructor(private readonly scene: Scene) {}

  get(id: MaterialId): StandardMaterial {
    const existing = this.cache.get(id);
    if (existing) return existing;
    const material = this.build(id);
    this.cache.set(id, material);
    return material;
  }

  /** Emissive sign face, cached per text/colour combination. */
  sign(text: string, ink: string, background = "#101014"): StandardMaterial {
    const key = `sign:${text}:${ink}`;
    const existing = this.cache.get(key);
    if (existing) return existing;

    const material = new StandardMaterial(key, this.scene);
    const texture = signTexture(this.scene, text, ink, background);
    material.diffuseTexture = texture;
    material.emissiveTexture = texture;
    material.emissiveColor = Color3.FromHexString(ink).scale(0.9);
    material.specularColor = Color3.Black();
    material.disableLighting = false;
    this.cache.set(key, material);
    return material;
  }

  /** Flat unlit colour — used for markers, tape, small accents. */
  flat(hex: string, emissive = 0): StandardMaterial {
    const key = `flat:${hex}:${emissive}`;
    const existing = this.cache.get(key);
    if (existing) return existing;
    const material = new StandardMaterial(key, this.scene);
    const colour = Color3.FromHexString(hex);
    material.diffuseColor = colour;
    material.emissiveColor = colour.scale(emissive);
    material.specularColor = new Color3(0.05, 0.05, 0.05);
    this.cache.set(key, material);
    return material;
  }

  private build(id: MaterialId): StandardMaterial {
    const material = new StandardMaterial(`mat.${id}`, this.scene);
    material.specularColor = new Color3(0.06, 0.06, 0.07);
    material.specularPower = 24;

    switch (id) {
      case "brickWarm": {
        // The source tile is 8 bricks x 16 courses, so this lands each brick
        // at roughly 22 cm on a typical facade panel.
        const texture = brickTexture(this.scene, 91, "#7a4f3e");
        texture.uScale = 7;
        texture.vScale = 7;
        material.diffuseTexture = texture;
        material.bumpTexture = null;
        break;
      }
      case "brickCold": {
        const texture = brickTexture(this.scene, 412, "#5c5148");
        texture.uScale = 7;
        texture.vScale = 7;
        material.diffuseTexture = texture;
        break;
      }
      case "concrete": {
        const texture = concreteTexture(this.scene, 7, "#6f6d69");
        texture.uScale = 4;
        texture.vScale = 4;
        material.diffuseTexture = texture;
        break;
      }
      case "concreteDark": {
        const texture = concreteTexture(this.scene, 88, "#4a4a4c");
        texture.uScale = 4;
        texture.vScale = 4;
        material.diffuseTexture = texture;
        break;
      }
      case "asphalt": {
        material.diffuseTexture = asphaltTexture(this.scene, 5);
        material.specularColor = new Color3(0.16, 0.17, 0.2);
        material.specularPower = 64;
        break;
      }
      case "shutter": {
        const texture = shutterTexture(this.scene, 31, "#5d636b");
        texture.uScale = 1;
        texture.vScale = 1;
        material.diffuseTexture = texture;
        material.specularColor = new Color3(0.12, 0.12, 0.14);
        break;
      }
      case "shutterBlue": {
        const texture = shutterTexture(this.scene, 77, "#3d4f63");
        material.diffuseTexture = texture;
        material.specularColor = new Color3(0.12, 0.12, 0.14);
        break;
      }
      case "metal": {
        material.diffuseTexture = metalTexture(this.scene, 12, "#585c63");
        material.specularColor = new Color3(0.2, 0.2, 0.22);
        material.specularPower = 48;
        break;
      }
      case "metalDark": {
        material.diffuseTexture = metalTexture(this.scene, 44, "#33363b");
        material.specularColor = new Color3(0.14, 0.14, 0.16);
        break;
      }
      case "chainLink": {
        const texture = chainLinkTexture(this.scene);
        material.diffuseTexture = texture;
        material.opacityTexture = texture;
        material.useAlphaFromDiffuseTexture = true;
        material.backFaceCulling = false;
        material.specularColor = new Color3(0.25, 0.25, 0.28);
        break;
      }
      case "puddle": {
        const texture = puddleTexture(this.scene, 3);
        material.diffuseTexture = texture;
        material.opacityTexture = texture;
        material.useAlphaFromDiffuseTexture = true;
        material.diffuseColor = new Color3(0.08, 0.1, 0.14);
        material.specularColor = new Color3(0.75, 0.8, 0.9);
        material.specularPower = 180;
        material.backFaceCulling = false;
        break;
      }
      case "glassDark": {
        material.diffuseColor = new Color3(0.03, 0.04, 0.06);
        material.specularColor = new Color3(0.5, 0.55, 0.65);
        material.specularPower = 128;
        material.alpha = 0.86;
        break;
      }
      case "wood": {
        const texture = concreteTexture(this.scene, 205, "#6b4a2c");
        texture.uScale = 2;
        texture.vScale = 2;
        material.diffuseTexture = texture;
        break;
      }
      case "trim": {
        material.diffuseColor = Color3.FromHexString("#2a2d33");
        break;
      }
    }

    if (material.diffuseTexture instanceof Texture) {
      material.diffuseTexture.anisotropicFilteringLevel = 4;
    }
    return material;
  }

  dispose(): void {
    for (const material of this.cache.values()) material.dispose(true, true);
    this.cache.clear();
  }
}
