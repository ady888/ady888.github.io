import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import { colourById } from "../paint/Palette";
import type { SupplyStash } from "./District";

const RESPAWN_SECONDS = 75;
export const PICKUP_RANGE = 2.0;

interface LiveStash {
  def: SupplyStash;
  node: TransformNode;
  cooldown: number;
  phase: number;
}

/**
 * Paint stashes.
 *
 * Supplies are the pacing mechanism: a fat cap on a big wall burns a can in a
 * couple of minutes, so the player has to break off, cross the district and
 * come back — which is exactly when witnesses get a look at them.
 */
export class PickupManager {
  private readonly stashes: LiveStash[] = [];

  constructor(scene: Scene, defs: SupplyStash[]) {
    for (const def of defs) {
      this.stashes.push({
        def,
        node: this.buildVisual(scene, def),
        cooldown: 0,
        phase: Math.random() * Math.PI * 2,
      });
    }
  }

  /** The stash the player could collect right now, if any. */
  nearest(position: Vector3): SupplyStash | null {
    let best: SupplyStash | null = null;
    let bestDistance = PICKUP_RANGE;
    for (const stash of this.stashes) {
      if (stash.cooldown > 0) continue;
      const distance = Vector3.Distance(position, stash.def.position);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = stash.def;
      }
    }
    return best;
  }

  /** Marks a stash as taken. Returns false if it was already on cooldown. */
  collect(id: string): boolean {
    const stash = this.stashes.find((entry) => entry.def.id === id);
    if (!stash || stash.cooldown > 0) return false;
    stash.cooldown = RESPAWN_SECONDS;
    stash.node.setEnabled(false);
    return true;
  }

  update(deltaSeconds: number): void {
    for (const stash of this.stashes) {
      if (stash.cooldown > 0) {
        stash.cooldown -= deltaSeconds;
        if (stash.cooldown <= 0) {
          stash.cooldown = 0;
          stash.node.setEnabled(true);
        }
        continue;
      }
      // Slow bob and spin so a stash catches the eye across a dark alley.
      stash.phase += deltaSeconds;
      stash.node.rotation.y += deltaSeconds * 0.7;
      stash.node.position.y = stash.def.position.y + Math.sin(stash.phase * 1.6) * 0.06;
    }
  }

  resetAll(): void {
    for (const stash of this.stashes) {
      stash.cooldown = 0;
      stash.node.setEnabled(true);
    }
  }

  dispose(): void {
    for (const stash of this.stashes) stash.node.dispose(false, true);
    this.stashes.length = 0;
  }

  private buildVisual(scene: Scene, def: SupplyStash): TransformNode {
    const root = new TransformNode(`stash.${def.id}`, scene);
    root.position.copyFrom(def.position);

    const tint = def.kind === "refill" ? "#35e0c4" : colourById(def.colourId ?? "chrome").hex;
    const bodyMaterial = new StandardMaterial(`stash.${def.id}.mat`, scene);
    bodyMaterial.diffuseColor = Color3.FromHexString(tint);
    bodyMaterial.emissiveColor = Color3.FromHexString(tint).scale(0.45);
    bodyMaterial.specularColor = new Color3(0.3, 0.3, 0.32);

    const capMaterial = new StandardMaterial(`stash.${def.id}.cap`, scene);
    capMaterial.diffuseColor = new Color3(0.12, 0.12, 0.14);

    const count = def.kind === "refill" ? 4 : 1;
    for (let i = 0; i < count; i += 1) {
      const angle = (i / Math.max(1, count)) * Math.PI * 2;
      const offset = count === 1 ? Vector3.Zero() : new Vector3(Math.cos(angle) * 0.13, 0, Math.sin(angle) * 0.13);

      const can = MeshBuilder.CreateCylinder(
        `stash.${def.id}.can${i}`,
        { diameter: 0.075, height: 0.21, tessellation: 12 },
        scene,
      );
      can.parent = root;
      can.position.copyFrom(offset);
      can.material = bodyMaterial;
      can.isPickable = false;

      const cap = MeshBuilder.CreateCylinder(
        `stash.${def.id}.cap${i}`,
        { diameter: 0.03, height: 0.04, tessellation: 8 },
        scene,
      );
      cap.parent = root;
      cap.position.copyFrom(offset.add(new Vector3(0, 0.125, 0)));
      cap.material = capMaterial;
      cap.isPickable = false;
    }

    // A faint marker ring on the ground, so stashes read at a distance.
    const ring = MeshBuilder.CreateTorus(
      `stash.${def.id}.ring`,
      { diameter: 0.5, thickness: 0.02, tessellation: 20 },
      scene,
    );
    ring.parent = root;
    ring.position.y = -def.position.y + 0.02;
    ring.material = bodyMaterial;
    ring.isPickable = false;

    return root;
  }
}
