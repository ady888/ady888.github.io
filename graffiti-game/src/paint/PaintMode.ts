import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

import type { EventBus } from "../core/EventBus";
import type { GameEventMap } from "../core/GameEvents";
import type { InputManager } from "../core/InputManager";
import type { PlayerController } from "../player/PlayerController";
import type { SoundBank } from "../audio/SoundBank";
import type { Inventory } from "../progression/Inventory";
import type { PieceScore } from "./PaintScoring";
import { PaintableSurface } from "./PaintableSurface";
import type { SurfaceManager } from "./SurfaceManager";
import { STENCILS } from "./Stencils";
import { GUIDED_ARTWORKS } from "./GuidedArtworks";
import { GuidedSession, type GuidedStatus } from "./GuidedPainting";
import { colourById } from "./Palette";

/** Reach: you have to be at the wall, but not pressed against it. */
export const PAINT_RANGE = 5;
const FINISH_HOLD_SECONDS = 0.7;
/** Brush radius in metres for a standard cap held at arm's length. */
const BASE_WORLD_RADIUS = 0.058;

/** Paint mode widens the view so you can see the whole piece you are working. */
const PAINT_FOV = 1.34;
/** Radians per second that WASD swings the aim. */
const AIM_YAW_SPEED = 1.15;
const AIM_PITCH_SPEED = 0.92;
/** Metres per second while holding Shift to reposition. */
const REPOSITION_SPEED = 2.65;

export interface PaintHudState {
  surfaceLabel: string;
  coverage: number;
  cursorX: number;
  cursorY: number;
  cursorRadius: number;
  onSurface: boolean;
  spraying: boolean;
  stencilMode: boolean;
  stencilName: string;
  finishProgress: number;
  pressure: number;
  paintLeft: number;
  drips: number;
  repositioning: boolean;
  guided: GuidedStatus | null;
  /** True while the spray trigger is held (mouse button or Space). */
  trigger: boolean;
  /** How much paint has gone down since entering paint mode. */
  sprayedThisSession: number;
}

/**
 * Paint mode.
 *
 * The control scheme is the one that makes fine linework possible:
 *
 *  - **The mouse is a real cursor.** Pointer lock is released on entry, so the
 *    pointer has absolute screen position and drags across the wall exactly
 *    like a drawing tool. A relative-delta virtual cursor cannot do this — it
 *    drifts, and you lose the ability to place a line where you meant to.
 *  - **WASD aims**, swinging the view smoothly rather than jumping. That frees
 *    the mouse entirely for painting.
 *  - **Shift + WASD repositions** the player without leaving paint mode, so a
 *    wall wider than the view is still reachable mid-piece.
 *  - **Wide FOV**, so most of a piece is on screen at once.
 *
 * Entry forces first person; the previous camera mode is restored on exit.
 */
export class PaintMode {
  active: PaintableSurface | null = null;

  private spraying = false;
  private wasSpraying = false;
  private finishHeld = 0;
  private stencilMode = false;
  private stencilIndex = 0;
  private stencilRotation = 0;
  private stencilSize = 0.55;
  private lastRadius = 12;
  private onSurface = false;
  private repositioning = false;
  private cameraModeBeforePaint = false;
  /** Ops laid down since entering, shown in the HUD so "nothing happened" is visible. */
  private sprayedOps = 0;
  /** Every panel touched in this session — a piece can span several. */
  private readonly touched = new Set<PaintableSurface>();
  /** Non-null while a guided artwork is being followed. */
  private guided: GuidedSession | null = null;
  private guidedIndex = 0;

  constructor(
    private readonly scene: Scene,
    private readonly input: InputManager,
    private readonly player: PlayerController,
    private readonly surfaces: SurfaceManager,
    private readonly inventory: Inventory,
    private readonly audio: SoundBank,
    private readonly bus: EventBus<GameEventMap>,
  ) {}

  get isActive(): boolean {
    return this.active !== null;
  }

  /** True once anything has been sprayed in this session. */
  get hasPaintThisSession(): boolean {
    return [...this.touched].some((surface) => surface.hasPaint);
  }

  /** True while the trigger is actually laying paint down. */
  get isSpraying(): boolean {
    return this.spraying;
  }

  get guidedSession(): GuidedSession | null {
    return this.guided;
  }

  /**
   * The spray trigger.
   *
   * The mouse button is the intended control, but Space works too. Painting is
   * the whole game, and a single input path is a single point of failure — if
   * the button ever fails to reach the canvas, the player still has a way to
   * put paint on a wall.
   */
  private get sprayHeld(): boolean {
    return this.input.primaryDown || this.input.isKeyDown("Space");
  }

  /**
   * Starts (or cancels) a guided artwork on the active surface.
   *
   * Guided mode goes third person: the point is to watch the writer work the
   * line, which you cannot do from behind their eyes.
   */
  toggleGuided(): string {
    if (this.guided) {
      this.guided.dispose();
      this.guided = null;
      this.player.firstPerson = true;
      this.player.setWideView(true, PAINT_FOV);
      return "Freehand";
    }
    const surface = this.active;
    if (!surface) return "Nothing to paint";

    const artwork = GUIDED_ARTWORKS[this.guidedIndex % GUIDED_ARTWORKS.length];
    this.guidedIndex += 1;
    this.guided = new GuidedSession(this.scene, this.player, artwork, surface);
    this.touched.add(surface);
    // Third person, normal FOV: framing is handled by the session.
    this.player.firstPerson = false;
    this.player.setWideView(false, 0);
    return artwork.name;
  }

  /** The surface the player could start painting right now, if any. */
  candidate(): PaintableSurface | null {
    const pick = this.scene.pickWithRay(
      this.player.makeViewRay(PAINT_RANGE + 1),
      (mesh: AbstractMesh) => Boolean(mesh.metadata?.paintable),
    );
    const looked = this.surfaces.fromMesh(pick?.pickedMesh);
    if (looked && (pick?.distance ?? Infinity) <= PAINT_RANGE + 1) return looked;
    return this.surfaces.nearest(this.player.position, PAINT_RANGE);
  }

  enter(surface: PaintableSurface): void {
    this.active = surface;
    surface.reopen();
    surface.breakStroke();

    this.finishHeld = 0;
    this.spraying = false;
    this.wasSpraying = false;
    this.repositioning = false;
    this.touched.clear();
    this.touched.add(surface);
    this.sprayedOps = 0;

    // Hand the mouse back to the player as a drawing cursor.
    this.input.releasePointerLock();
    this.scene.getEngine().getRenderingCanvas()?.classList.add("paint-mode");

    this.cameraModeBeforePaint = this.player.firstPerson;
    this.player.firstPerson = true;
    this.player.paintPose = true;
    this.player.setWideView(true, PAINT_FOV);
    this.player.allowAthletics = false;

    this.bus.emit("paint:started", { surfaceId: surface.id });
    this.bus.emit("prompt:changed", { text: null });
  }

  exit(): void {
    if (!this.active) return;
    const surfaceId = this.active.id;
    this.active.breakStroke();
    this.restorePlayer();
    this.active = null;
    this.bus.emit("paint:stopped", { surfaceId });
  }

  /**
   * Commits the piece and returns its score.
   *
   * A piece can run across several panels — walls butt together and the cursor
   * crosses the seams — so every panel touched this session is committed. Fame
   * is paid once, for the best of them, rather than per panel: otherwise
   * smearing across four panels would pay four times for one piece.
   */
  finish(): PieceScore | null {
    const painted = [...this.touched].filter((surface) => surface.hasPaint);
    if (painted.length === 0) return null;

    let best: { surface: PaintableSurface; score: PieceScore } | null = null;
    for (const surface of painted) {
      const score = surface.commit();
      if (!best || score.total > best.score.total) best = { surface, score };
    }

    this.restorePlayer();
    this.active = null;
    this.touched.clear();
    if (!best) return null;
    this.bus.emit("paint:finished", { surfaceId: best.surface.id, score: best.score });
    return best.score;
  }

  private restorePlayer(): void {
    this.stopSpraying();
    this.guided?.dispose();
    this.guided = null;
    this.player.setPaintTarget(null);
    this.player.setFramingFocus(null);
    this.scene.getEngine().getRenderingCanvas()?.classList.remove("paint-mode");
    this.player.firstPerson = this.cameraModeBeforePaint;
    this.player.paintPose = false;
    this.player.setWideView(false, 0);
    this.player.allowAthletics = true;
    this.player.movementScale = 1;
  }

  update(deltaSeconds: number): void {
    const surface = this.active;
    if (!surface) return;

    this.handleHotkeys();

    if (this.guided) {
      this.updateGuided(deltaSeconds, surface);
      return;
    }

    this.updateAimAndMovement(deltaSeconds);

    const can = this.inventory.current;
    const cap = this.inventory.capProfile;
    const wantsSpray = this.sprayHeld && !this.stencilMode;
    const hasPaint = Boolean(can && can.amount > 0);

    const hit = this.pickSurface(surface);
    this.onSurface = hit !== null;

    if (wantsSpray && hasPaint) {
      this.startSpraying();
      if (hit) {
        const distance = Math.max(0.25, hit.distance);
        // Hold the can further back and the cone opens up, as it should.
        const distanceFactor = Scalar.Clamp(distance / 0.75, 0.65, 2.3);
        const worldRadius = BASE_WORLD_RADIUS * cap.radius * distanceFactor;
        const radiusPx = worldRadius * (surface.texWidth / surface.worldWidth);
        this.lastRadius = radiusPx;

        const pressure = can ? Scalar.Clamp(can.pressure, 0.18, 1) : 1;
        const sputter = pressure < 0.45 ? 0.45 + Math.random() * 0.55 : 1;
        const alpha = Scalar.Clamp(
          deltaSeconds * 9 * cap.flow * (0.35 + pressure * 0.65) * sputter,
          0.01,
          0.85,
        );

        surface.spray(
          hit.u,
          hit.v,
          radiusPx,
          this.inventory.currentColour.hex,
          alpha,
          cap.scatter * (0.6 + (1 - pressure) * 0.8),
          this.wasSpraying,
        );
        this.inventory.consume(deltaSeconds);
        this.sprayedOps += 1;
        this.audio.updateSpray(pressure, cap.radius);
        this.bus.emit("paint:strokeTick", { surfaceId: surface.id, coverage: surface.coverage });
        this.wasSpraying = true;
      } else {
        surface.noteOverspray();
        this.wasSpraying = false;
      }
    } else {
      if (wantsSpray && !hasPaint && this.input.primaryPressed) {
        this.bus.emit("toast", {
          text: "Can's empty — press C for the next colour, or find a stash.",
          kind: "warn",
        });
      }
      this.stopSpraying();
      surface.breakStroke();
      this.wasSpraying = false;
      this.inventory.restPressure(deltaSeconds);
    }

    if (this.stencilMode && this.input.primaryPressed && hit && hasPaint) {
      const sizePx = this.stencilSize * (surface.texHeight / surface.worldHeight);
      const stencil = STENCILS[this.stencilIndex];
      if (this.inventory.unlockedStencils.has(stencil.id)) {
        surface.stamp(stencil.id, hit.u, hit.v, sizePx, this.stencilRotation, this.inventory.currentColour.hex);
        this.inventory.consume(0.55);
        this.audio.rattle();
      } else {
        this.bus.emit("toast", { text: `${stencil.name} stencil not unlocked yet.`, kind: "warn" });
      }
    }

    // Finishing: hold E, or hit Enter.
    if (this.input.isDown("interact")) {
      this.finishHeld += deltaSeconds;
    } else {
      this.finishHeld = 0;
    }
  }

  /**
   * Guided painting tick.
   *
   * The session owns everything: it walks the player into place, decides how
   * far the guide has advanced, and hands back the corrected point to paint.
   * All this does is supply the inputs and apply the paint it asks for.
   */
  private updateGuided(deltaSeconds: number, surface: PaintableSurface): void {
    const guided = this.guided;
    if (!guided) return;

    const can = this.inventory.current;
    const hasPaint = Boolean(can && can.amount > 0);
    const wantsSpray = this.sprayHeld && hasPaint && !guided.isRepositioning;

    if (wantsSpray) this.startSpraying();
    else this.stopSpraying();

    // Guided painting stays locked to its own surface: following the cursor onto
    // a neighbour mid-artwork would strand the guide on the wrong wall.
    const hit = wantsSpray ? this.pickOn(guided.surface) : null;
    this.onSurface = hit !== null;
    void surface;

    guided.update(
      deltaSeconds,
      wantsSpray,
      hit ? { u: hit.u, v: hit.v } : null,
      (from, to, colourId, weight) => {
        const target = guided.surface;
        const cap = this.inventory.capProfile;
        const radiusPx =
          BASE_WORLD_RADIUS * cap.radius * 1.9 * weight * (target.texWidth / target.worldWidth);
        this.lastRadius = radiusPx;
        const colour = this.inventory.canSpray()
          ? this.inventory.currentColour.hex
          : colourById(colourId).hex;
        const alpha = Scalar.Clamp(deltaSeconds * 11 * cap.flow, 0.02, 0.9);

        // Draw the leading edge first so a slow frame still joins up, then the
        // segment itself; `from === null` is the post-pause case and must not
        // connect back to wherever the last stroke ended.
        if (from) {
          target.spray(from.u, from.v, radiusPx, colour, alpha * 0.6, cap.scatter * 0.5, false);
          target.spray(to.u, to.v, radiusPx, colour, alpha, cap.scatter * 0.6, true);
        } else {
          target.spray(to.u, to.v, radiusPx, colour, alpha, cap.scatter * 0.6, false);
        }
        this.inventory.consume(deltaSeconds);
        this.sprayedOps += 1;
        this.touched.add(target);
        this.bus.emit("paint:strokeTick", { surfaceId: target.id, coverage: target.coverage });
      },
    );

    // The can hand tracks the live guide head, but only while actually spraying.
    this.player.paintPose = guided.phase === "painting";
    this.player.setPaintTarget(guided.phase === "painting" ? guided.headWorld : null);
    this.player.setFramingFocus(guided.isComplete ? null : guided.cameraFocus());

    if (guided.isComplete && this.input.primaryPressed) {
      this.bus.emit("toast", { text: `${guided.artwork.name} finished`, kind: "good", ttl: 2600 });
    }

    if (this.input.isDown("interact")) this.finishHeld += deltaSeconds;
    else this.finishHeld = 0;
  }

  /**
   * WASD aims by default; holding Shift turns the same keys into movement so
   * you can walk along a long wall without dropping out of paint mode.
   */
  private updateAimAndMovement(deltaSeconds: number): void {
    const forwardAxis = this.input.axis("back", "forward");
    const strafeAxis = this.input.axis("left", "right");
    this.repositioning = this.input.isDown("run");

    if (this.repositioning) {
      this.player.applyMovementFromAxes(deltaSeconds, forwardAxis, strafeAxis, REPOSITION_SPEED);
      return;
    }

    if (forwardAxis !== 0 || strafeAxis !== 0) {
      this.player.aimBy(
        strafeAxis * AIM_YAW_SPEED * deltaSeconds,
        -forwardAxis * AIM_PITCH_SPEED * deltaSeconds,
      );
    }
    // Still needs a physics step so gravity and standing still behave.
    this.player.applyMovementFromAxes(deltaSeconds, 0, 0, 0);
  }

  /** True once the player has held the finish key long enough. */
  get finishRequested(): boolean {
    return this.finishHeld >= FINISH_HOLD_SECONDS || this.input.wasKeyPressed("Enter");
  }

  hudState(): PaintHudState {
    const surface = this.active;
    const can = this.inventory.current;
    const engine = this.scene.getEngine();
    const distance = surface
      ? Math.max(0.3, Vector3.Distance(this.player.eyePosition, surface.worldCentre))
      : 1;
    const worldRadius = surface ? (this.lastRadius * surface.worldWidth) / surface.texWidth : 0.08;
    const screenRadius =
      (worldRadius * engine.getRenderHeight()) / (2 * distance * Math.tan(this.player.camera.fov / 2));

    return {
      surfaceLabel: surface?.label ?? "",
      coverage: surface?.coverage ?? 0,
      cursorX: this.input.pointerX,
      cursorY: this.input.pointerY,
      cursorRadius: Scalar.Clamp(screenRadius, 4, 180),
      onSurface: this.onSurface,
      spraying: this.spraying,
      stencilMode: this.stencilMode,
      stencilName: STENCILS[this.stencilIndex].name,
      finishProgress: Scalar.Clamp(this.finishHeld / FINISH_HOLD_SECONDS, 0, 1),
      pressure: can?.pressure ?? 0,
      paintLeft: can?.amount ?? 0,
      drips: surface?.activeDripCount ?? 0,
      repositioning: this.repositioning,
      guided: this.guided ? this.guided.status() : null,
      trigger: this.sprayHeld,
      sprayedThisSession: this.sprayedOps,
    };
  }

  // ----------------------------------------------------------------- private

  private handleHotkeys(): void {
    const wheel = this.input.consumeWheel();
    if (wheel !== 0) {
      if (this.stencilMode) {
        this.stencilSize = Scalar.Clamp(this.stencilSize - Math.sign(wheel) * 0.06, 0.2, 1.6);
      } else {
        this.inventory.cycle(wheel > 0 ? 1 : -1);
        this.bus.emit("paint:cansChanged", undefined);
      }
    }

    // C cycles colour, matching the scheme this was modelled on.
    if (this.input.wasKeyPressed("KeyC")) {
      this.inventory.cycle(1);
      this.bus.emit("paint:cansChanged", undefined);
      this.bus.emit("toast", { text: this.inventory.currentColour.name, kind: "good", ttl: 1100 });
    }

    for (let i = 1; i <= 9; i += 1) {
      if (this.input.wasKeyPressed(`Digit${i}`)) {
        this.inventory.select(i - 1);
        this.bus.emit("paint:cansChanged", undefined);
      }
    }

    if (this.input.wasKeyPressed("KeyQ")) {
      const cap = this.inventory.cycleCap(1);
      this.bus.emit("toast", {
        text: `${cap === "fat" ? "Fat cap" : cap === "skinny" ? "Skinny cap" : "Standard cap"} on`,
        kind: "good",
        ttl: 1200,
      });
      this.bus.emit("paint:cansChanged", undefined);
    }

    if (this.input.wasKeyPressed("KeyR")) {
      if (this.inventory.shake()) {
        this.audio.rattle();
        this.bus.emit("toast", { text: "Shaken — pressure back up", kind: "good", ttl: 1200 });
      }
    }

    if (this.input.wasKeyPressed("KeyZ") && this.active) {
      if (this.active.undo()) {
        this.bus.emit("toast", { text: "Undid last stroke", kind: "good", ttl: 1000 });
      }
    }

    if (this.input.wasKeyPressed("KeyB") && this.active) {
      this.active.buff("#6f6f6c", 0.9);
      this.bus.emit("toast", { text: "Base coat down", kind: "good", ttl: 1200 });
    }

    if (this.input.wasKeyPressed("KeyF")) {
      const label = this.toggleGuided();
      this.bus.emit("toast", {
        text: this.guided ? `Guided: ${label} — hold the spray button and follow the line` : label,
        kind: "good",
        ttl: 3200,
      });
    }

    if (this.input.wasKeyPressed("KeyT")) {
      this.stencilMode = !this.stencilMode;
      this.bus.emit("toast", {
        text: this.stencilMode ? "Stencil mode — click to stamp" : "Freehand",
        kind: "good",
        ttl: 1200,
      });
    }

    if (this.stencilMode) {
      if (this.input.wasKeyPressed("BracketLeft")) {
        this.stencilIndex = (this.stencilIndex - 1 + STENCILS.length) % STENCILS.length;
      }
      if (this.input.wasKeyPressed("BracketRight")) {
        this.stencilIndex = (this.stencilIndex + 1) % STENCILS.length;
      }
      if (this.input.isKeyDown("Comma")) this.stencilRotation -= 0.05;
      if (this.input.isKeyDown("Period")) this.stencilRotation += 0.05;
    }
  }

  /** Picks the cursor against one specific surface, ignoring its neighbours. */
  /**
   * Where the cursor meets a surface, by ray-plane intersection.
   *
   * This deliberately does NOT rely on mesh picking. The paint panels are
   * invisible until they carry paint, they have frozen world matrices, and
   * there are ~60 of them — any one of those can quietly make `scene.pick`
   * return nothing, and when it does the player gets a spray cursor that
   * paints absolutely nothing with no indication why. Intersecting the plane
   * arithmetically cannot fail for a surface we already know we are at.
   */
  private uvOnSurface(
    surface: PaintableSurface,
    ray: Ray,
  ): { u: number; v: number; distance: number } | null {
    const normal = surface.normal;
    const denominator = Vector3.Dot(ray.direction, normal);
    // Facing the back of the panel, or exactly edge-on.
    if (denominator > -1e-4) return null;

    const distance = Vector3.Dot(surface.worldCentre.subtract(ray.origin), normal) / denominator;
    if (distance < 0 || distance > PAINT_RANGE + 3) return null;

    const point = ray.origin.add(ray.direction.scale(distance));
    const offset = point.subtract(surface.worldCentre);

    // Surface-local axes: `along` runs across its width, world up its height.
    const along = new Vector3(-normal.z, 0, normal.x);
    const lateral = offset.x * along.x + offset.z * along.z;
    const vertical = offset.y;

    const u = lateral / surface.worldWidth + 0.5;
    const v = vertical / surface.worldHeight + 0.5;
    if (u < 0 || u > 1 || v < 0 || v > 1) return null;
    return { u, v, distance };
  }

  /** The camera ray through the current mouse position. */
  private cursorRay(): Ray {
    const ray = this.scene.createPickingRay(
      this.input.pointerX,
      this.input.pointerY,
      Matrix.Identity(),
      this.player.camera,
    );
    return ray;
  }

  /** Cursor position on one specific surface, ignoring its neighbours. */
  private pickOn(surface: PaintableSurface): { u: number; v: number; distance: number } | null {
    return this.uvOnSurface(surface, this.cursorRay());
  }

  /**
   * Cursor position on whichever paintable surface it is over.
   *
   * Every candidate is tested by plane intersection and the nearest hit wins,
   * so following the cursor across a seam moves onto the neighbouring panel —
   * walls butt up against each other and forcing a re-entry at every seam
   * would be miserable.
   */
  private pickSurface(entry: PaintableSurface): { u: number; v: number; distance: number } | null {
    const ray = this.cursorRay();

    let bestSurface: PaintableSurface | null = null;
    let best: { u: number; v: number; distance: number } | null = null;

    // The surface we are working on gets first refusal, then its neighbours.
    const seen = new Set<PaintableSurface>();
    for (const candidate of [entry, ...this.surfaces.all]) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      const hit = this.uvOnSurface(candidate, ray);
      if (!hit) continue;
      if (!best || hit.distance < best.distance) {
        best = hit;
        bestSurface = candidate;
      }
    }

    if (!best || !bestSurface) return null;

    if (bestSurface !== this.active) {
      this.active?.breakStroke();
      this.active = bestSurface;
      this.touched.add(bestSurface);
      bestSurface.reopen();
      this.wasSpraying = false;
    }
    return best;
  }

  private startSpraying(): void {
    if (this.spraying) return;
    this.spraying = true;
    this.audio.startSpray();
  }

  private stopSpraying(): void {
    if (!this.spraying) return;
    this.spraying = false;
    this.audio.stopSpray();
  }
}
