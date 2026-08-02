import { Ray } from "@babylonjs/core/Culling/ray";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import type { PlayerController } from "../player/PlayerController";
import type { PaintableSurface } from "./PaintableSurface";
import { GuideOverlay, type ArtworkPlacement } from "./GuideOverlay";
import {
  resampleStroke,
  sampleAt,
  type GuidedArtwork,
  type ResampledStroke,
} from "./GuidedArtworks";

export type GuidedPhase = "positioning" | "ready" | "painting" | "paused" | "complete";

/** How far in front of the wall the player is placed, relative to piece width. */
const VIEW_DISTANCE_FACTOR = 0.62;
const MIN_STAND_DISTANCE = 1.9;
const MAX_STAND_DISTANCE = 4.6;
/** Player walk speed while being placed, m/s. */
const APPROACH_SPEED = 2.6;
/** Guide progress per second at full alignment, in artwork-space units. */
const BASE_ADVANCE_RATE = 0.17;
/** Aim error (artwork-space) beyond which the guide stops advancing. */
const FOLLOW_TOLERANCE = 0.14;
/** How strongly the stroke is pulled onto the guide. 1 would be fully automatic. */
const CORRECTION_STRENGTH = 0.62;
/** Largest advance allowed in one frame, so a stall cannot cause a jump. */
const MAX_ADVANCE_PER_FRAME = 0.05;

export interface GuidedStatus {
  phase: GuidedPhase;
  artworkName: string;
  strokeIndex: number;
  strokeCount: number;
  /** 0..1 across the whole artwork. */
  progress: number;
  /** 0..1 how well the player is tracking the guide right now. */
  alignment: number;
  /** True while the player is off the line and progress is stalled. */
  offGuide: boolean;
  hint: string;
}

/**
 * The one authoritative guided-painting state.
 *
 * Everything that has to stay in step lives here: whether paint is going down,
 * how far along the guide we are, how much the stroke is corrected, where the
 * player stands, where the camera looks, and when the piece is finished. Any of
 * those living somewhere else is how they drift apart.
 *
 * The central rule is that **progress is a function of painting**, not of time:
 * the guide only advances on frames where paint is actually applied, so
 * releasing the trigger freezes it exactly where it was and resuming continues
 * from that point.
 */
export class GuidedSession {
  phase: GuidedPhase = "positioning";

  readonly artwork: GuidedArtwork;
  readonly surface: PaintableSurface;
  readonly placement: ArtworkPlacement;

  private readonly strokes: ResampledStroke[];
  private readonly overlay: GuideOverlay;

  private strokeIndex = 0;
  private distanceAlong = 0;
  private alignment = 0;
  private offGuide = false;

  /** Last point painted, in surface UV, for gap-free continuation. */
  private lastPaintedUV: { u: number; v: number } | null = null;
  /** False after any pause, so the next dab does not connect to the old point. */
  private continuous = false;

  private standTarget: Vector3;
  private standYaw: number;
  private repositioning = true;

  constructor(
    private readonly scene: Scene,
    private readonly player: PlayerController,
    artwork: GuidedArtwork,
    surface: PaintableSurface,
  ) {
    this.artwork = artwork;
    this.surface = surface;
    this.strokes = artwork.strokes.map((stroke) => resampleStroke(stroke));
    this.placement = computePlacement(artwork, surface);
    this.overlay = new GuideOverlay(scene, surface);

    const { position, yaw } = this.computeStandPoint(this.activeHeadUV());
    this.standTarget = position;
    this.standYaw = yaw;
  }

  get isComplete(): boolean {
    return this.phase === "complete";
  }

  /** World point of the guide head, for camera framing and the can hand. */
  get headWorld(): Vector3 {
    return this.uvToWorld(this.activeHeadUV());
  }

  status(): GuidedStatus {
    const total = this.strokes.reduce((sum, stroke) => sum + stroke.total, 0) || 1;
    let done = 0;
    for (let i = 0; i < this.strokeIndex; i += 1) done += this.strokes[i].total;
    done += Math.min(this.distanceAlong, this.strokes[this.strokeIndex]?.total ?? 0);

    let hint = "Hold the spray button and follow the line";
    if (this.phase === "positioning") hint = "Moving into position…";
    else if (this.phase === "complete") hint = "Piece complete — hold E to step back";
    else if (this.offGuide) hint = "Bring the can back onto the line";
    else if (this.phase === "paused") hint = "Paused — hold to carry on from here";

    return {
      phase: this.phase,
      artworkName: this.artwork.name,
      strokeIndex: Math.min(this.strokeIndex, this.strokes.length - 1),
      strokeCount: this.strokes.length,
      progress: Scalar.Clamp(done / total, 0, 1),
      alignment: this.alignment,
      offGuide: this.offGuide,
      hint,
    };
  }

  /**
   * Advances the session.
   *
   * @param spraying   true while the player is holding the spray input
   * @param aimUV      where the player is aiming on the surface, or null if off
   * @param paint      applies a stroke segment on the surface; returns nothing
   */
  update(
    deltaSeconds: number,
    spraying: boolean,
    aimUV: { u: number; v: number } | null,
    paint: (
      from: { u: number; v: number } | null,
      to: { u: number; v: number },
      colourId: string,
      weight: number,
    ) => void,
  ): void {
    if (this.phase === "complete") {
      this.overlay.render(this.strokes, this.placement, this.strokes.length, 0, deltaSeconds);
      this.updateApproach(deltaSeconds);
      return;
    }

    this.updateApproach(deltaSeconds);
    if (this.repositioning) {
      this.phase = "positioning";
      this.pauseStroke();
      this.overlay.render(this.strokes, this.placement, this.strokeIndex, this.distanceAlong, deltaSeconds);
      return;
    }

    const stroke = this.strokes[this.strokeIndex];
    if (!stroke) {
      this.complete();
      return;
    }

    // Paint is gated purely on the input. No spray, no progress, ever.
    if (!spraying || !aimUV) {
      this.pauseStroke();
      this.phase = this.phase === "positioning" ? "ready" : "paused";
      this.overlay.render(this.strokes, this.placement, this.strokeIndex, this.distanceAlong, deltaSeconds);
      return;
    }

    this.phase = "painting";

    const head = sampleAt(stroke, this.distanceAlong);
    const aimArt = this.uvToArtwork(aimUV);
    const errorX = aimArt.x - head.x;
    const errorY = aimArt.y - head.y;
    const error = Math.hypot(errorX, errorY);

    this.alignment = Scalar.Clamp(1 - error / FOLLOW_TOLERANCE, 0, 1);
    this.offGuide = error > FOLLOW_TOLERANCE;

    if (this.offGuide) {
      // Too far off to count: the player still sprays (their paint, their wall)
      // but the guide waits. This is what keeps it assisted rather than
      // automatic — wander off and you simply make a mess, as you should.
      const target = this.artworkToUV(aimArt);
      paint(this.continuous ? this.lastPaintedUV : null, target, stroke.colourId, stroke.weight);
      this.lastPaintedUV = target;
      this.continuous = true;
      this.overlay.render(this.strokes, this.placement, this.strokeIndex, this.distanceAlong, deltaSeconds);
      return;
    }

    // Advance along the guide. Rate scales with how well the player is tracking
    // and with how far ahead of the head they are reaching, so leading the line
    // draws faster and hesitating slows it, but neither can skip.
    const lead = Math.max(0, errorX * head.tx + errorY * head.ty);
    const rate = BASE_ADVANCE_RATE * (0.45 + this.alignment * 0.55) * (1 + lead * 4);
    const advance = Math.min(rate * deltaSeconds, MAX_ADVANCE_PER_FRAME);
    this.distanceAlong = Math.min(stroke.total, this.distanceAlong + advance);

    // Paint at a point pulled towards the guide — a gentle correction, never a
    // snap: the player's own aim still shapes the line.
    const corrected = sampleAt(stroke, this.distanceAlong);
    const paintArt = {
      x: aimArt.x + (corrected.x - aimArt.x) * CORRECTION_STRENGTH,
      y: aimArt.y + (corrected.y - aimArt.y) * CORRECTION_STRENGTH,
    };
    const target = this.artworkToUV(paintArt);

    // Always draw as a segment from the previous point, so a slow frame cannot
    // leave a gap; `continuous` is false only on the first dab after a pause,
    // which is what stops a line being drawn across from wherever we left off.
    paint(this.continuous ? this.lastPaintedUV : null, target, stroke.colourId, stroke.weight);
    this.lastPaintedUV = target;
    this.continuous = true;

    if (this.distanceAlong >= stroke.total - 1e-4) {
      this.strokeIndex += 1;
      this.distanceAlong = 0;
      // A new stroke starts somewhere else on the wall: break the line.
      this.pauseStroke();
      if (this.strokeIndex >= this.strokes.length) {
        this.complete();
      } else {
        this.considerReposition();
      }
    } else {
      this.considerReposition();
    }

    this.overlay.render(this.strokes, this.placement, this.strokeIndex, this.distanceAlong, deltaSeconds);
  }

  /** Ends the stroke cleanly. Safe to call repeatedly. */
  pauseStroke(): void {
    this.continuous = false;
    this.lastPaintedUV = null;
    this.surface.breakStroke();
  }

  dispose(): void {
    this.overlay.dispose();
  }

  // ---------------------------------------------------------------- position

  /** Where the camera should look: between the player and the live guide head. */
  cameraFocus(): Vector3 {
    const head = this.headWorld;
    const player = this.player.position.add(new Vector3(0, 1.4, 0));
    return Vector3.Lerp(player, head, 0.58);
  }

  get isRepositioning(): boolean {
    return this.repositioning;
  }

  /**
   * Walks the player to the stand point rather than teleporting.
   *
   * Movement goes through the same swept-ellipsoid step as normal walking, so
   * the approach cannot push anyone through a skip or a wall.
   */
  private updateApproach(deltaSeconds: number): void {
    const toTarget = this.standTarget.subtract(this.player.position);
    toTarget.y = 0;
    const distance = toTarget.length();

    // Face the wall throughout, so the framing settles before the line starts.
    this.player.faceTowards(this.standYaw, deltaSeconds, 4.5);

    if (distance < 0.18) {
      this.repositioning = false;
      this.player.applyMovementFromAxes(deltaSeconds, 0, 0, 0);
      return;
    }

    const direction = toTarget.scale(1 / distance);
    // Convert the world direction into the player's own forward/strafe axes.
    const forward = new Vector3(Math.sin(this.player.aimYaw), 0, Math.cos(this.player.aimYaw));
    const right = new Vector3(Math.cos(this.player.aimYaw), 0, -Math.sin(this.player.aimYaw));
    const forwardAxis = direction.x * forward.x + direction.z * forward.z;
    const strafeAxis = direction.x * right.x + direction.z * right.z;

    const speed = Math.min(APPROACH_SPEED, distance * 3.2);
    this.player.applyMovementFromAxes(deltaSeconds, forwardAxis, strafeAxis, speed);
  }

  /** Moves the stand point when the guide head drifts out of comfortable reach. */
  private considerReposition(): void {
    const head = this.activeHeadUV();
    const headWorld = this.uvToWorld(head);
    const offset = headWorld.subtract(this.player.position);
    offset.y = 0;
    // Sideways distance from the player to the part being painted.
    const along = new Vector3(-this.surface.normal.z, 0, this.surface.normal.x);
    const lateral = Math.abs(offset.x * along.x + offset.z * along.z);
    if (lateral < 1.6) return;

    const next = this.computeStandPoint(head);
    this.standTarget = next.position;
    this.standYaw = next.yaw;
    this.repositioning = true;
  }

  /**
   * Picks where to stand for a given point on the artwork.
   *
   * Distance comes from the artwork's width so the whole piece stays in frame,
   * clamped to a range that is close enough to reach and far enough to see. The
   * point is then validated against the world: if it lands inside geometry we
   * pull it back towards the wall until it is clear.
   */
  private computeStandPoint(headUV: { u: number; v: number }): { position: Vector3; yaw: number } {
    const normal = this.surface.normal;
    const along = new Vector3(-normal.z, 0, normal.x);

    // Centre on the active part of the artwork, not the whole surface.
    const artworkWidthWorld = this.placement.halfU * 2 * this.surface.worldWidth;
    const lateral = (headUV.u - 0.5) * this.surface.worldWidth;
    const anchor = this.surface.worldCentre.add(along.scale(lateral));

    const distance = Scalar.Clamp(
      artworkWidthWorld * VIEW_DISTANCE_FACTOR,
      MIN_STAND_DISTANCE,
      MAX_STAND_DISTANCE,
    );

    let position = new Vector3(anchor.x, 0, anchor.z).add(normal.scale(distance));
    position = this.pullClear(anchor, position, distance);

    // Face the wall.
    const yaw = Math.atan2(-normal.x, -normal.z);
    return { position, yaw };
  }

  /** Pulls a stand point in until it is not inside anything solid. */
  private pullClear(anchor: Vector3, desired: Vector3, distance: number): Vector3 {
    const origin = new Vector3(anchor.x, 1.0, anchor.z);
    const direction = desired.subtract(new Vector3(anchor.x, 0, anchor.z));
    direction.y = 0;
    const length = direction.length();
    if (length < 1e-4) return desired;
    direction.scaleInPlace(1 / length);

    const hit = this.scene.pickWithRay(
      new Ray(origin, direction, distance + 0.6),
      (mesh) => mesh.checkCollisions && mesh.isVisible && mesh !== this.player.body,
    );
    if (hit?.hit && typeof hit.distance === "number") {
      const safe = Math.max(MIN_STAND_DISTANCE * 0.7, hit.distance - 0.55);
      return new Vector3(anchor.x, 0, anchor.z).add(direction.scale(safe));
    }
    return desired;
  }

  // ------------------------------------------------------------- conversions

  private activeHeadUV(): { u: number; v: number } {
    const stroke = this.strokes[Math.min(this.strokeIndex, this.strokes.length - 1)];
    if (!stroke) return { u: this.placement.u, v: this.placement.v };
    const head = sampleAt(stroke, this.distanceAlong);
    return this.artworkToUV(head);
  }

  private artworkToUV(point: { x: number; y: number }): { u: number; v: number } {
    return {
      u: this.placement.u + (point.x - 0.5) * this.placement.halfU * 2,
      v: this.placement.v + (point.y - 0.5) * this.placement.halfV * 2,
    };
  }

  private uvToArtwork(uv: { u: number; v: number }): { x: number; y: number } {
    return {
      x: (uv.u - this.placement.u) / (this.placement.halfU * 2) + 0.5,
      y: (uv.v - this.placement.v) / (this.placement.halfV * 2) + 0.5,
    };
  }

  private uvToWorld(uv: { u: number; v: number }): Vector3 {
    const normal = this.surface.normal;
    const along = new Vector3(-normal.z, 0, normal.x);
    const lateral = (uv.u - 0.5) * this.surface.worldWidth;
    const height = (uv.v - 0.5) * this.surface.worldHeight;
    return this.surface.worldCentre.add(along.scale(lateral)).add(new Vector3(0, height, 0));
  }

  private complete(): void {
    this.phase = "complete";
    this.pauseStroke();
    this.overlay.setVisible(false);
  }
}

/** Fits the artwork into the middle of a surface, respecting its aspect. */
function computePlacement(artwork: GuidedArtwork, surface: PaintableSurface): ArtworkPlacement {
  const targetWidth = Math.min(artwork.preferredWidth, surface.worldWidth * 0.86);
  const targetHeight = Math.min(targetWidth / artwork.aspect, surface.worldHeight * 0.72);
  const width = targetHeight * artwork.aspect;

  return {
    u: 0.5,
    v: 0.5,
    halfU: width / surface.worldWidth / 2,
    halfV: targetHeight / surface.worldHeight / 2,
  };
}
