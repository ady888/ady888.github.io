import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import { Actor, type ActorLook } from "./Actor";

export type PedestrianState = "patrol" | "curious" | "alarmed" | "fleeing";

export interface PedestrianSenses {
  playerPosition: Vector3;
  /** 0..1 how loudly the player is moving. */
  playerNoise: number;
  /** True while the player is actively spraying a wall. */
  playerPainting: boolean;
  /** Risk rating of the wall being painted, if any. */
  paintingRisk: number;
  /** Crouching players are harder to notice. */
  playerCrouched: boolean;
}

const VIEW_RANGE = 21;
const VIEW_HALF_ANGLE = Math.PI * 0.42; // ~76° each side
const HEAR_RANGE = 13;

/**
 * A resident going about their night.
 *
 * Witnesses are the game's early-warning system: they do not arrest anyone,
 * they just notice, react, and phone it in. Suspicion is a slow build so the
 * player always gets a beat to duck behind a skip before the heat lands.
 */
export class Pedestrian extends Actor {
  state: PedestrianState = "patrol";
  suspicion = 0;
  /** Set for one frame in the update where the witness decides to report. */
  reportedThisFrame = false;

  private waypointIndex = 0;
  private waitTimer = 0;
  private stateTimer = 0;
  private lastSeenPlayer: Vector3 | null = null;
  private cooldown = 0;

  constructor(
    scene: Scene,
    name: string,
    private readonly route: Vector3[],
    look: ActorLook,
    startIndex = 0,
  ) {
    super(scene, name, look, route[startIndex % route.length].clone());
    this.waypointIndex = startIndex % route.length;
    this.speed = 1.1 + Math.random() * 0.5;
  }

  get isAlarmed(): boolean {
    return this.state === "alarmed" || this.state === "fleeing";
  }

  update(deltaSeconds: number, senses: PedestrianSenses): void {
    this.reportedThisFrame = false;
    this.stateTimer += deltaSeconds;
    this.cooldown = Math.max(0, this.cooldown - deltaSeconds);

    const sees = this.canSee(
      senses.playerPosition.add(new Vector3(0, 1.2, 0)),
      VIEW_RANGE,
      VIEW_HALF_ANGLE,
    );
    const distance = Vector3.Distance(this.position, senses.playerPosition);
    const hears = senses.playerNoise > 0.25 && distance < HEAR_RANGE;

    this.updateSuspicion(deltaSeconds, senses, sees, hears, distance);

    switch (this.state) {
      case "patrol":
        this.patrol(deltaSeconds);
        if (this.suspicion > 0.35) this.setState("curious");
        break;

      case "curious":
        // Stop, turn, and stare at whatever caught their attention.
        this.lookAt(this.lastSeenPlayer ?? senses.playerPosition, deltaSeconds);
        this.animateIdle(deltaSeconds);
        if (this.suspicion >= 1) {
          this.setState("alarmed");
          this.reportedThisFrame = true;
          this.cooldown = 25;
        } else if (this.suspicion < 0.12 || this.stateTimer > 9) {
          this.setState("patrol");
        }
        break;

      case "alarmed":
        this.lookAt(senses.playerPosition, deltaSeconds);
        this.animateIdle(deltaSeconds);
        if (this.stateTimer > 1.6) this.setState("fleeing");
        break;

      case "fleeing": {
        // Head for the far end of the route, quickly.
        const target = this.route[(this.waypointIndex + Math.ceil(this.route.length / 2)) % this.route.length];
        if (this.moveTowards(target, deltaSeconds, 3.4) || this.stateTimer > 12) {
          this.suspicion = 0;
          this.setState("patrol");
        }
        break;
      }
    }
  }

  private updateSuspicion(
    deltaSeconds: number,
    senses: PedestrianSenses,
    sees: boolean,
    hears: boolean,
    distance: number,
  ): void {
    if (this.cooldown > 0 && this.state === "patrol") {
      // Just reported; give the player a window before this one bites again.
      this.suspicion = Math.max(0, this.suspicion - deltaSeconds * 0.6);
      return;
    }

    // Walking down an alley is not a crime. Suspicion only builds while the
    // player is actually spraying a wall — a witness who merely sees you go
    // past has nothing to report, so nothing here should tick up for it.
    let rate = -0.28;
    if (sees && senses.playerPainting) {
      this.lastSeenPlayer = senses.playerPosition.clone();
      // Closer and more exposed spots make you far more obvious.
      const proximity = Scalar.Clamp(1 - distance / VIEW_RANGE, 0.1, 1);
      rate = 0.3 + proximity * 0.25 + senses.paintingRisk * 0.55;
      if (senses.playerCrouched) rate *= 0.6;
    } else if (hears && senses.playerPainting) {
      // The hiss of a can carries further than footsteps do.
      rate = 0.12 * Math.max(senses.playerNoise, 0.5);
    }

    this.suspicion = Scalar.Clamp(this.suspicion + rate * deltaSeconds, 0, 1);
  }

  private patrol(deltaSeconds: number): void {
    if (this.waitTimer > 0) {
      this.waitTimer -= deltaSeconds;
      this.animateIdle(deltaSeconds);
      return;
    }
    const target = this.route[this.waypointIndex];
    if (this.moveTowards(target, deltaSeconds)) {
      this.waypointIndex = (this.waypointIndex + 1) % this.route.length;
      // Pause now and then, so routes do not look like conveyor belts.
      if (Math.random() < 0.35) this.waitTimer = 1 + Math.random() * 3;
    }
  }

  private setState(state: PedestrianState): void {
    this.state = state;
    this.stateTimer = 0;
  }
}
