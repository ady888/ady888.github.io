import { Scalar } from "@babylonjs/core/Maths/math.scalar";

import type { EventBus } from "../core/EventBus";
import type { GameEventMap } from "../core/GameEvents";

const MAX_STARS = 5;
/** Heat must sit at zero this long before the search is called off. */
const CLEAR_DELAY = 2.5;

/**
 * Wanted level.
 *
 * Heat rises when someone reports you or an officer has eyes on you, and bleeds
 * off only while nobody does — faster if you are somewhere the police would not
 * think to look. The "searching" flag is separate from the star count so the
 * HUD can show that they are still out there after the stars start dropping.
 */
export class HeatSystem {
  private value = 0;
  private sinceLastSighting = 0;
  private clearTimer = 0;
  private searching = false;
  private lastEmittedStars = -1;
  private lastEmittedSearching = false;

  constructor(private readonly bus: EventBus<GameEventMap>) {}

  get stars(): number {
    return Math.min(MAX_STARS, Math.ceil(this.value - 1e-6));
  }

  get raw(): number {
    return this.value;
  }

  get isSearching(): boolean {
    return this.searching;
  }

  get isWanted(): boolean {
    return this.value > 0;
  }

  /** A witness phoned it in. */
  report(risk: number): void {
    this.add(0.8 + risk * 0.7);
    this.searching = true;
    this.sinceLastSighting = 0;
  }

  /** An officer currently has eyes on the player. */
  sighted(deltaSeconds: number): void {
    this.sinceLastSighting = 0;
    this.searching = true;
    this.add(deltaSeconds * 0.16);
  }

  /** Getting caught red-handed at a spot bumps you straight up. */
  add(amount: number): void {
    this.value = Scalar.Clamp(this.value + amount, 0, MAX_STARS);
    if (this.value > 0) this.searching = true;
    this.emitIfChanged();
  }

  setStars(stars: number): void {
    this.value = Scalar.Clamp(stars, 0, MAX_STARS);
    this.searching = this.value > 0;
    this.emitIfChanged();
  }

  clear(): void {
    this.value = 0;
    this.searching = false;
    this.sinceLastSighting = 0;
    this.clearTimer = 0;
    this.emitIfChanged();
  }

  /**
   * @param hidden true when the player is inside a hideout volume with nobody
   *               looking at them — decay runs several times faster there.
   */
  update(deltaSeconds: number, hidden: boolean): void {
    this.sinceLastSighting += deltaSeconds;

    if (this.sinceLastSighting > 4) {
      // Higher stars are stickier; a five-star night does not just evaporate.
      // Roughly: four stars takes ~45 s to shake in the open, ~15 s somewhere
      // the police would not think to look.
      const base = hidden ? 0.55 : 0.18;
      const stickiness = 1 / (1 + this.value * 0.55);
      this.value = Math.max(0, this.value - deltaSeconds * base * stickiness);
    }

    if (this.value <= 0.001 && this.searching) {
      this.clearTimer += deltaSeconds;
      if (this.clearTimer >= CLEAR_DELAY) {
        this.searching = false;
        this.clearTimer = 0;
      }
    } else if (this.value > 0.001) {
      this.clearTimer = 0;
    }

    this.emitIfChanged();
  }

  private emitIfChanged(): void {
    const stars = this.stars;
    if (stars === this.lastEmittedStars && this.searching === this.lastEmittedSearching) return;
    this.lastEmittedStars = stars;
    this.lastEmittedSearching = this.searching;
    this.bus.emit("heat:changed", { stars, searching: this.searching });
  }
}
