import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
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

/** Reach: you have to actually stand at the wall to paint it. */
export const PAINT_RANGE = 2.6;
const FINISH_HOLD_SECONDS = 0.7;
/** Brush radius in metres for a standard cap held at arm's length. */
const BASE_WORLD_RADIUS = 0.058;

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
}

/**
 * Paint mode.
 *
 * Entering locks the camera to face the wall and hands the mouse to a spray
 * cursor rather than to head-look — the same trade real spray-paint games make,
 * because free-look plus a fixed reticle makes fine linework impossible. The
 * player can still shuffle along the wall with WASD to reach the far end of a
 * big piece, and crouch to get down to the skirting.
 */
export class PaintMode {
  active: PaintableSurface | null = null;

  private cursorX = 0;
  private cursorY = 0;
  private spraying = false;
  private wasSpraying = false;
  private finishHeld = 0;
  private stencilMode = false;
  private stencilIndex = 0;
  private stencilRotation = 0;
  private stencilSize = 0.55;
  private lastRadius = 12;
  private onSurface = false;

  // Camera framing tween, run while we settle the view onto the wall.
  private framing = false;
  private frameYaw = 0;
  private framePitch = 0;

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

  /** True while the trigger is actually laying paint down. */
  get isSpraying(): boolean {
    return this.spraying;
  }

  /** The surface the player could start painting right now, if any. */
  candidate(): PaintableSurface | null {
    const pick = this.scene.pickWithRay(
      this.player.makeViewRay(PAINT_RANGE + 0.6),
      (mesh: AbstractMesh) => Boolean(mesh.metadata?.paintable),
    );
    const looked = this.surfaces.fromMesh(pick?.pickedMesh);
    if (looked && (pick?.distance ?? Infinity) <= PAINT_RANGE + 0.6) return looked;
    return this.surfaces.nearest(this.player.position, PAINT_RANGE);
  }

  enter(surface: PaintableSurface): void {
    this.active = surface;
    surface.reopen();
    surface.breakStroke();

    const engine = this.scene.getEngine();
    this.cursorX = engine.getRenderWidth() / 2;
    this.cursorY = engine.getRenderHeight() / 2;
    this.finishHeld = 0;
    this.spraying = false;
    this.wasSpraying = false;

    // Aim the camera squarely at the wall so the cursor plane is stable.
    const toSurface = surface.worldCentre.subtract(this.player.eyePosition);
    this.frameYaw = Math.atan2(toSurface.x, toSurface.z);
    this.framePitch = -Math.atan2(toSurface.y, Math.hypot(toSurface.x, toSurface.z));
    this.framing = true;

    this.player.movementScale = 0.42;
    this.player.allowAthletics = false;

    this.bus.emit("paint:started", { surfaceId: surface.id });
    this.bus.emit("prompt:changed", { text: null });
  }

  exit(): void {
    if (!this.active) return;
    const surfaceId = this.active.id;
    this.active.breakStroke();
    this.stopSpraying();
    this.active = null;
    this.framing = false;
    this.player.movementScale = 1;
    this.player.allowAthletics = true;
    this.bus.emit("paint:stopped", { surfaceId });
  }

  /** Commits the piece and returns its score. */
  finish(): PieceScore | null {
    const surface = this.active;
    if (!surface || !surface.hasPaint) return null;
    const score = surface.commit();
    this.stopSpraying();
    this.active = null;
    this.framing = false;
    this.player.movementScale = 1;
    this.player.allowAthletics = true;
    this.bus.emit("paint:finished", { surfaceId: surface.id, score });
    return score;
  }

  update(deltaSeconds: number): void {
    const surface = this.active;
    if (!surface) return;

    this.updateFraming(deltaSeconds);
    this.updateCursor();
    this.handleHotkeys();

    const can = this.inventory.current;
    const cap = this.inventory.capProfile;
    const wantsSpray = this.input.primaryDown && !this.stencilMode;
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
        // Low pressure sputters: the alpha stutters instead of laying flat.
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
        this.audio.updateSpray(pressure, cap.radius);
        this.bus.emit("paint:strokeTick", { surfaceId: surface.id, coverage: surface.coverage });
        this.wasSpraying = true;
      } else {
        surface.noteOverspray();
        this.wasSpraying = false;
      }
    } else {
      if (wantsSpray && !hasPaint && this.input.primaryPressed) {
        this.bus.emit("toast", { text: "Can's empty — cycle with the wheel or find a stash.", kind: "warn" });
      }
      this.stopSpraying();
      surface.breakStroke();
      this.wasSpraying = false;
      this.inventory.restPressure(deltaSeconds);
    }

    // Stencils stamp on click rather than streaming.
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

  /** True once the player has held the finish key long enough. */
  get finishRequested(): boolean {
    return this.finishHeld >= FINISH_HOLD_SECONDS || this.input.wasKeyPressed("Enter");
  }

  hudState(): PaintHudState {
    const surface = this.active;
    const can = this.inventory.current;
    const engine = this.scene.getEngine();
    // Convert the world-space brush radius into pixels for the on-screen ring.
    const distance = surface
      ? Math.max(0.3, Vector3.Distance(this.player.eyePosition, surface.worldCentre))
      : 1;
    const worldRadius = surface ? (this.lastRadius * surface.worldWidth) / surface.texWidth : 0.08;
    const screenRadius =
      (worldRadius * engine.getRenderHeight()) / (2 * distance * Math.tan(this.player.camera.fov / 2));

    return {
      surfaceLabel: surface?.label ?? "",
      coverage: surface?.coverage ?? 0,
      cursorX: this.cursorX,
      cursorY: this.cursorY,
      cursorRadius: Scalar.Clamp(screenRadius, 4, 180),
      onSurface: this.onSurface,
      spraying: this.spraying,
      stencilMode: this.stencilMode,
      stencilName: STENCILS[this.stencilIndex].name,
      finishProgress: Scalar.Clamp(this.finishHeld / FINISH_HOLD_SECONDS, 0, 1),
      pressure: can?.pressure ?? 0,
      paintLeft: can?.amount ?? 0,
      drips: surface?.activeDripCount ?? 0,
    };
  }

  // ----------------------------------------------------------------- private

  private updateFraming(deltaSeconds: number): void {
    if (!this.framing) return;
    const camera = this.player.camera;
    const yaw = Scalar.Lerp(camera.rotation.y, this.frameYaw, Math.min(1, deltaSeconds * 9));
    const pitch = Scalar.Lerp(camera.rotation.x, this.framePitch, Math.min(1, deltaSeconds * 9));
    camera.rotation.set(pitch, yaw, 0);
    if (
      Math.abs(yaw - this.frameYaw) < 0.004 &&
      Math.abs(pitch - this.framePitch) < 0.004
    ) {
      camera.rotation.set(this.framePitch, this.frameYaw, 0);
      this.framing = false;
    }
  }

  private updateCursor(): void {
    const look = this.input.consumeLook();
    const engine = this.scene.getEngine();
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    // Slower than head-look: this is a wrist, not a neck.
    this.cursorX = Scalar.Clamp(this.cursorX + look.x * 0.85, 0, width);
    this.cursorY = Scalar.Clamp(this.cursorY + look.y * 0.85, 0, height);
  }

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

    for (let i = 1; i <= 9; i += 1) {
      if (this.input.wasKeyPressed(`Digit${i}`)) {
        this.inventory.select(i - 1);
        this.bus.emit("paint:cansChanged", undefined);
      }
    }

    if (this.input.wasKeyPressed("KeyQ")) {
      const cap = this.inventory.cycleCap(1);
      this.bus.emit("toast", { text: `${cap === "fat" ? "Fat cap" : cap === "skinny" ? "Skinny cap" : "Standard cap"} on`, kind: "good", ttl: 1200 });
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

  /** Picks through the spray cursor and returns UV on the active surface. */
  private pickSurface(surface: PaintableSurface): { u: number; v: number; distance: number } | null {
    const pick = this.scene.pick(this.cursorX, this.cursorY, (mesh: AbstractMesh) => mesh === surface.mesh);
    if (!pick?.hit || pick.pickedMesh !== surface.mesh) return null;
    const uv = pick.getTextureCoordinates();
    if (!uv) return null;
    if (pick.distance > PAINT_RANGE + 1.4) return null;
    return { u: uv.x, v: uv.y, distance: pick.distance };
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
