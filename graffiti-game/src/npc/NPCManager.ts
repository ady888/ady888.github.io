import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import type { DistrictData } from "../world/District";
import type { EventBus } from "../core/EventBus";
import type { GameEventMap } from "../core/GameEvents";
import type { SoundBank } from "../audio/SoundBank";
import { HeatSystem } from "./HeatSystem";
import { Officer } from "./Police";
import { Pedestrian, type PedestrianSenses } from "./Pedestrian";

const LOOKS = [
  { coat: "#3b4a63", trousers: "#22252d", skin: "#e0b48f" },
  { coat: "#5c3b3b", trousers: "#2b2b30", skin: "#7a5236", accent: "#1e1e22" },
  { coat: "#2f5445", trousers: "#1f232b", skin: "#c99a74" },
  { coat: "#4a3f5e", trousers: "#26262e", skin: "#8d6247", accent: "#6b2f2f" },
  { coat: "#6b6152", trousers: "#2a2a2f", skin: "#e6c3a1" },
];

/** How many officers respond at each wanted level. */
const OFFICERS_FOR_STARS = [0, 1, 2, 3, 4, 5];

export interface WorldSenses extends PedestrianSenses {
  /** True when the player is inside a hideout and nobody has eyes on them. */
  hidden: boolean;
}

export interface NPCTickResult {
  /** The closest officer's distance, or Infinity when none are out. */
  nearestOfficer: number;
  /** True while at least one officer can see the player this frame. */
  seenByPolice: boolean;
  /** True on the frame an officer completes an arrest. */
  busted: boolean;
  /** Peak witness suspicion this frame, for the HUD's "eye" indicator. */
  peakSuspicion: number;
}

/**
 * Owns the alley's population and the wanted level that connects them.
 *
 * Pedestrians exist all the time; officers are spawned on demand from the
 * district's entry points and removed once they give up, which keeps the actor
 * count low and makes a chase feel like it arrives from somewhere.
 */
export class NPCManager {
  readonly heat: HeatSystem;

  private readonly pedestrians: Pedestrian[] = [];
  private readonly officers: Officer[] = [];
  private reportedPosition: Vector3 | null = null;
  private sirenPlaying = false;
  private escapeWatchStars = 0;

  constructor(
    private readonly scene: Scene,
    private readonly district: DistrictData,
    private readonly bus: EventBus<GameEventMap>,
    private readonly audio: SoundBank,
  ) {
    this.heat = new HeatSystem(bus);

    let index = 0;
    for (const route of district.pedestrianRoutes) {
      // Two walkers per route, started at opposite ends so they cross.
      for (let i = 0; i < 2; i += 1) {
        const look = LOOKS[index % LOOKS.length];
        this.pedestrians.push(
          new Pedestrian(
            scene,
            `pedestrian.${index}`,
            route,
            look,
            i === 0 ? 0 : Math.floor(route.length / 2),
          ),
        );
        index += 1;
      }
    }
  }

  get officerCount(): number {
    return this.officers.length;
  }

  get witnessCount(): number {
    return this.pedestrians.length;
  }

  update(deltaSeconds: number, senses: WorldSenses): NPCTickResult {
    let peakSuspicion = 0;

    for (const pedestrian of this.pedestrians) {
      pedestrian.update(deltaSeconds, senses);
      peakSuspicion = Math.max(peakSuspicion, pedestrian.suspicion);
      if (pedestrian.reportedThisFrame) {
        this.reportedPosition = senses.playerPosition.clone();
        this.heat.report(senses.paintingRisk);
        this.audio.whistle();
        this.bus.emit("player:spotted", { by: "witness", intensity: 1 });
        this.bus.emit("toast", {
          text: "Someone clocked you and made a call.",
          kind: "bad",
        });
      }
    }

    this.syncOfficerCount();

    let nearestOfficer = Infinity;
    let seenByPolice = false;
    let busted = false;

    for (const officer of this.officers) {
      officer.update(deltaSeconds, senses.playerPosition, senses.hidden, this.reportedPosition);
      nearestOfficer = Math.min(nearestOfficer, officer.distanceTo(senses.playerPosition));
      if (officer.state === "chasing" || officer.state === "grabbing") {
        seenByPolice = true;
        this.heat.sighted(deltaSeconds);
        this.reportedPosition = senses.playerPosition.clone();
      }
      if (officer.caughtPlayer) busted = true;
    }

    // Officers that have wandered home are recycled.
    for (let i = this.officers.length - 1; i >= 0; i -= 1) {
      if (this.officers[i].hasGivenUp) {
        this.officers[i].dispose();
        this.officers.splice(i, 1);
      }
    }

    const starsBefore = this.heat.stars;
    this.heat.update(deltaSeconds, senses.hidden && !seenByPolice);
    this.trackEscape(starsBefore);
    this.updateSiren(nearestOfficer);

    return { nearestOfficer, seenByPolice, busted, peakSuspicion };
  }

  /** Called after an arrest: clear the response and reset attention. */
  resetPursuit(): void {
    for (const officer of this.officers) officer.dispose();
    this.officers.length = 0;
    this.reportedPosition = null;
    this.heat.clear();
    this.escapeWatchStars = 0;
    this.audio.stopSiren();
    this.sirenPlaying = false;
  }

  setVisible(visible: boolean): void {
    for (const pedestrian of this.pedestrians) pedestrian.setVisible(visible);
    for (const officer of this.officers) officer.setVisible(visible);
  }

  dispose(): void {
    for (const pedestrian of this.pedestrians) pedestrian.dispose();
    for (const officer of this.officers) officer.dispose();
    this.pedestrians.length = 0;
    this.officers.length = 0;
    this.audio.stopSiren();
  }

  // ----------------------------------------------------------------- private

  private syncOfficerCount(): void {
    const wanted = OFFICERS_FOR_STARS[Math.min(this.heat.stars, OFFICERS_FOR_STARS.length - 1)];
    while (this.officers.length < wanted) {
      const spawn = this.pickSpawn();
      const officer = new Officer(
        this.scene,
        `officer.${this.officers.length}.${Date.now()}`,
        spawn,
        this.reportedPosition ?? spawn,
      );
      this.officers.push(officer);
    }
    // We never despawn mid-chase; officers leave under their own steam.
  }

  /** Spawn from whichever district entrance is furthest from the incident. */
  private pickSpawn(): Vector3 {
    const spawns = this.district.policeSpawns;
    if (!this.reportedPosition) return spawns[Math.floor(Math.random() * spawns.length)].clone();
    let best = spawns[0];
    let bestScore = -Infinity;
    for (const spawn of spawns) {
      const distance = Vector3.Distance(spawn, this.reportedPosition);
      // Prefer somewhere 25–45 m out: close enough to matter, not on top of you.
      const score = -Math.abs(distance - 34) + Math.random() * 6;
      if (score > bestScore) {
        bestScore = score;
        best = spawn;
      }
    }
    return best.clone();
  }

  /** Watches for the player shaking a serious chase, for the "Ghost" mission. */
  private trackEscape(starsBefore: number): void {
    this.escapeWatchStars = Math.max(this.escapeWatchStars, starsBefore);
    if (this.escapeWatchStars >= 3 && !this.heat.isSearching && this.heat.stars === 0) {
      this.bus.emit("player:escaped", { fromStars: this.escapeWatchStars });
      this.escapeWatchStars = 0;
    }
    if (!this.heat.isWanted && !this.heat.isSearching && this.escapeWatchStars < 3) {
      this.escapeWatchStars = 0;
    }
  }

  private updateSiren(nearestOfficer: number): void {
    const shouldPlay = this.officers.length > 0 && nearestOfficer < 70;
    if (shouldPlay) {
      const intensity = Math.max(0, 1 - nearestOfficer / 70);
      this.audio.startSiren(intensity);
      this.sirenPlaying = true;
    } else if (this.sirenPlaying) {
      this.audio.stopSiren();
      this.sirenPlaying = false;
    }
  }
}
