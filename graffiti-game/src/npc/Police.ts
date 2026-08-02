import { Color3 } from "@babylonjs/core/Maths/math.color";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import { Actor } from "./Actor";

export type OfficerState = "searching" | "chasing" | "grabbing" | "returning";

const VIEW_RANGE = 26;
const VIEW_HALF_ANGLE = Math.PI * 0.38;
const CATCH_RADIUS = 1.5;
const GRAB_TIME = 0.8;
const GIVE_UP_SECONDS = 16;

/**
 * A responding officer.
 *
 * Officers know roughly where you were reported and sweep towards it; they only
 * get an exact fix while they can actually see you. Losing them is a matter of
 * breaking line of sight and staying broken, which is what makes the covered
 * spots in the district worth knowing.
 */
export class Officer extends Actor {
  state: OfficerState = "searching";
  /** Set for one frame when the officer completes a grab. */
  caughtPlayer = false;

  private target: Vector3;
  private grabTimer = 0;
  private lostTimer = 0;
  private searchTimer = 0;
  private readonly spawnPoint: Vector3;
  private readonly torch: PointLight;

  constructor(scene: Scene, name: string, spawn: Vector3, initialTarget: Vector3) {
    super(
      scene,
      name,
      { coat: "#1d2b47", trousers: "#161c2b", skin: "#c9a48a", accent: "#0f1626", height: 1.84 },
      spawn.clone(),
    );
    this.spawnPoint = spawn.clone();
    this.target = initialTarget.clone();
    this.speed = 4.2;

    // Hi-vis banding, so an officer is unmistakable at a glance in the dark.
    const band = MeshBuilder.CreateBox(`${name}.band`, { width: 0.48, height: 0.1, depth: 0.28 }, scene);
    band.parent = this.root;
    band.position.y = 1.16;
    const bandMaterial = new StandardMaterial(`${name}.bandMat`, scene);
    bandMaterial.diffuseColor = Color3.FromHexString("#e8ff3a");
    bandMaterial.emissiveColor = Color3.FromHexString("#8fa020");
    band.material = bandMaterial;
    band.isPickable = false;
    this.parts.push(band);

    this.torch = new PointLight(`${name}.torch`, Vector3.Zero(), scene);
    this.torch.parent = this.root;
    this.torch.position.set(0, 1.5, 0.7);
    this.torch.diffuse = new Color3(0.95, 0.95, 0.85);
    this.torch.intensity = 0.85;
    this.torch.range = 13;
  }

  /** Distance from the player, used to drive siren volume and HUD warnings. */
  distanceTo(point: Vector3): number {
    return Vector3.Distance(this.position, point);
  }

  get hasGivenUp(): boolean {
    return this.state === "returning" && Vector3.Distance(this.position, this.spawnPoint) < 2;
  }

  update(
    deltaSeconds: number,
    playerPosition: Vector3,
    playerHidden: boolean,
    reportedPosition: Vector3 | null,
  ): void {
    this.caughtPlayer = false;

    const sees =
      !playerHidden &&
      this.canSee(playerPosition.add(new Vector3(0, 1.2, 0)), VIEW_RANGE, VIEW_HALF_ANGLE);

    if (sees) {
      this.target = playerPosition.clone();
      this.lostTimer = 0;
      if (this.state !== "grabbing") this.state = "chasing";
    } else {
      this.lostTimer += deltaSeconds;
      if (this.state === "chasing" && this.lostTimer > 2.5) {
        this.state = "searching";
        this.searchTimer = 0;
      }
      if (reportedPosition && this.state === "searching" && this.lostTimer < GIVE_UP_SECONDS) {
        this.target = reportedPosition.clone();
      }
    }

    switch (this.state) {
      case "chasing": {
        const distance = this.distanceTo(playerPosition);
        this.moveTowards(this.target, deltaSeconds, this.speed);
        if (distance < CATCH_RADIUS) {
          this.state = "grabbing";
          this.grabTimer = 0;
        }
        break;
      }

      case "grabbing": {
        this.lookAt(playerPosition, deltaSeconds);
        this.animateIdle(deltaSeconds);
        this.grabTimer += deltaSeconds;
        if (this.distanceTo(playerPosition) > CATCH_RADIUS * 1.7) {
          this.state = "chasing";
        } else if (this.grabTimer >= GRAB_TIME) {
          this.caughtPlayer = true;
          this.grabTimer = 0;
        }
        break;
      }

      case "searching": {
        this.searchTimer += deltaSeconds;
        // Sweep to the last known point, then cast about nearby.
        if (this.moveTowards(this.target, deltaSeconds, this.speed * 0.72)) {
          const angle = this.searchTimer * 1.4;
          this.target = this.position.add(new Vector3(Math.cos(angle) * 6, 0, Math.sin(angle) * 6));
        }
        if (this.lostTimer > GIVE_UP_SECONDS) this.state = "returning";
        break;
      }

      case "returning":
        this.moveTowards(this.spawnPoint, deltaSeconds, this.speed * 0.6);
        break;
    }
  }

  override dispose(): void {
    this.torch.dispose();
    super.dispose();
  }
}
