import { Matrix, Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { Viewport } from "@babylonjs/core/Maths/math.viewport";
import { CreateScreenshotUsingRenderTargetAsync } from "@babylonjs/core/Misc/screenshotTools";
import type { Scene } from "@babylonjs/core/scene";

// Screenshots go through Babylon's DumpTools, which blits the render target
// with the "pass" post-process on its own throwaway engine. In an ES-module
// build those shaders are only registered by importing them explicitly —
// without these two lines the capture fails with a shader compile error.
import "@babylonjs/core/Shaders/pass.fragment";
import "@babylonjs/core/Shaders/postprocess.vertex";
import "@babylonjs/core/ShadersWGSL/pass.fragment";
import "@babylonjs/core/ShadersWGSL/postprocess.vertex";

import type { InputManager } from "../core/InputManager";
import type { PaintableSurface } from "../paint/PaintableSurface";
import type { PlayerController } from "../player/PlayerController";
import type { SoundBank } from "../audio/SoundBank";
import type { SurfaceManager } from "../paint/SurfaceManager";
import { gradeFor } from "../paint/PaintScoring";
import type { PhotoRecord } from "./Gallery";

const MIN_FOV = 0.34;
const MAX_FOV = 1.0;
const SHOT_WIDTH = 480;
const SHOT_HEIGHT = 300;

export interface PhotoHudState {
  targetLabel: string | null;
  framing: number;
  zoom: number;
  distance: number;
  heatStars: number;
  ready: boolean;
  hint: string;
}

interface FramingResult {
  surface: PaintableSurface;
  framing: number;
  fill: number;
  centring: number;
  squareness: number;
  distance: number;
}

/**
 * Photo mode.
 *
 * A piece only earns fame once someone sees it, and the photo is how that
 * happens — so framing is scored rather than just "press the button". The
 * evaluation rewards filling the frame, standing square to the wall, and
 * keeping the piece centred, which naturally pushes the player back out into
 * the open where the interesting risk is.
 */
export class PhotoMode {
  private baseFov = 0.9;
  private fov = 0.62;
  private cached: FramingResult | null = null;
  private busy = false;

  constructor(
    private readonly scene: Scene,
    private readonly input: InputManager,
    private readonly player: PlayerController,
    private readonly surfaces: SurfaceManager,
    private readonly audio: SoundBank,
  ) {}

  enter(): void {
    this.baseFov = this.player.camera.fov;
    this.fov = Math.min(this.baseFov, 0.62);
    this.player.camera.fov = this.fov;
    this.player.movementScale = 0.6;
    this.player.allowAthletics = false;
  }

  exit(): void {
    this.player.camera.fov = this.baseFov;
    this.player.movementScale = 1;
    this.player.allowAthletics = true;
  }

  update(deltaSeconds: number): void {
    const wheel = this.input.consumeWheel();
    if (wheel !== 0) {
      this.fov = Scalar.Clamp(this.fov + Math.sign(wheel) * 0.05, MIN_FOV, MAX_FOV);
    }
    this.player.camera.fov = Scalar.Lerp(this.player.camera.fov, this.fov, Math.min(1, deltaSeconds * 10));
    this.cached = this.evaluateFraming();
  }

  hudState(heatStars: number): PhotoHudState {
    const result = this.cached;
    let hint = "Find one of your pieces";
    if (result) {
      if (result.fill < 0.18) hint = "Too far — move in";
      else if (result.fill > 0.92) hint = "Too tight — back off";
      else if (result.squareness < 0.55) hint = "Square up to the wall";
      else if (result.centring < 0.6) hint = "Centre it in the frame";
      else hint = "Nice — take the shot";
    }
    return {
      targetLabel: result?.surface.label ?? null,
      framing: result?.framing ?? 0,
      zoom: (MAX_FOV - this.player.camera.fov) / (MAX_FOV - MIN_FOV),
      distance: result?.distance ?? 0,
      heatStars,
      ready: Boolean(result && result.framing > 0.05),
      hint,
    };
  }

  /** Captures the current frame. Returns null when nothing worth shooting. */
  async capture(heatStars: number): Promise<PhotoRecord | null> {
    if (this.busy) return null;
    const result = this.cached;
    if (!result) return null;
    this.busy = true;
    this.audio.cameraShutter();

    let thumbnail = "";
    try {
      thumbnail = await CreateScreenshotUsingRenderTargetAsync(
        this.scene.getEngine(),
        this.player.camera,
        { width: SHOT_WIDTH, height: SHOT_HEIGHT },
        "image/jpeg",
        1,
        false,
        undefined,
        false,
        false,
        false,
        0.72,
      );
    } catch (error) {
      console.warn("[PhotoMode] screenshot failed", error);
    } finally {
      this.busy = false;
    }

    const surface = result.surface;
    const pieceScore = surface.score?.total ?? Math.round(surface.coverage * 55);
    const grade = surface.score?.grade ?? gradeFor(pieceScore);

    // Danger sells: a shot taken with the law out is worth more.
    const dangerBonus = 1 + Math.min(heatStars, 5) * 0.09;
    const score = Math.round(
      Scalar.Clamp(result.framing * 0.55 + (pieceScore / 100) * 0.45, 0, 1) * 100 * dangerBonus,
    );
    const fameValue = Math.round(score * (0.9 + surface.risk * 1.1));

    return {
      id: `photo_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
      surfaceId: surface.id,
      surfaceLabel: surface.label,
      thumbnail,
      takenAt: Date.now(),
      framing: result.framing,
      pieceScore,
      grade,
      heatStars,
      score: Math.min(100, score),
      fameValue,
      posted: false,
    };
  }

  // ----------------------------------------------------------------- private

  /** Scores how well the best visible painted surface sits in the frame. */
  private evaluateFraming(): FramingResult | null {
    const engine = this.scene.getEngine();
    const width = engine.getRenderWidth();
    const height = engine.getRenderHeight();
    const viewport = new Viewport(0, 0, width, height);
    const transform = this.scene.getTransformMatrix();
    const eye = this.player.eyePosition;
    const view = this.player.forward;

    let best: FramingResult | null = null;

    for (const surface of this.surfaces.painted) {
      const toSurface = surface.worldCentre.subtract(eye);
      const distance = toSurface.length();
      if (distance > 45 || distance < 0.4) continue;
      // Must be in front of us and roughly facing us.
      if (Vector3.Dot(toSurface.normalize(), view) < 0.35) continue;
      const squareness = Scalar.Clamp(Vector3.Dot(surface.normal, view.scale(-1)), 0, 1);
      if (squareness < 0.2) continue;
      if (!this.hasLineOfSight(eye, surface)) continue;

      // Project the four corners of the piece into screen space.
      const world = surface.mesh.getWorldMatrix();
      const halfW = surface.worldWidth / 2;
      const halfH = surface.worldHeight / 2;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      let anyBehind = false;

      for (const [dx, dy] of [
        [-halfW, -halfH],
        [halfW, -halfH],
        [halfW, halfH],
        [-halfW, halfH],
      ] as const) {
        const corner = Vector3.TransformCoordinates(new Vector3(dx, dy, 0), world);
        if (Vector3.Dot(corner.subtract(eye), view) <= 0.05) {
          anyBehind = true;
          break;
        }
        const projected = Vector3.Project(corner, Matrix.Identity(), transform, viewport);
        minX = Math.min(minX, projected.x);
        maxX = Math.max(maxX, projected.x);
        minY = Math.min(minY, projected.y);
        maxY = Math.max(maxY, projected.y);
      }
      if (anyBehind) continue;

      // The viewfinder is inset 12% / 8%, so score against that, not the canvas.
      const frameW = width * 0.76;
      const frameH = height * 0.84;
      const boxW = maxX - minX;
      const boxH = maxY - minY;
      if (boxW <= 0 || boxH <= 0) continue;

      const fill = Scalar.Clamp((boxW * boxH) / (frameW * frameH), 0, 1.4);
      // Peak value at ~55% of the frame; punished for cropping or being a speck.
      const fillScore = fill > 0.98 ? Math.max(0, 1 - (fill - 0.98) * 1.6) : Scalar.Clamp(fill / 0.55, 0, 1);

      const centreX = (minX + maxX) / 2;
      const centreY = (minY + maxY) / 2;
      const offset = Math.hypot((centreX - width / 2) / (width / 2), (centreY - height / 2) / (height / 2));
      const centring = Scalar.Clamp(1 - offset * 1.15, 0, 1);

      // Coverage keeps a barely-touched wall from scoring like a finished piece.
      const substance = Scalar.Clamp(surface.coverage / 0.3, 0.15, 1);

      const framing = Scalar.Clamp(
        fillScore * 0.42 + centring * 0.26 + squareness * 0.2 + substance * 0.12,
        0,
        1,
      );

      if (!best || framing > best.framing) {
        best = { surface, framing, fill, centring, squareness, distance };
      }
    }

    return best;
  }

  private hasLineOfSight(eye: Vector3, surface: PaintableSurface): boolean {
    const pick = this.scene.pickWithRay(this.player.makeViewRay(60), (mesh) =>
      Boolean(mesh.metadata?.paintable) || mesh.checkCollisions,
    );
    if (!pick?.hit) return true;
    // If the first thing the ray hits is this surface, nothing is in the way.
    if (pick.pickedMesh === surface.mesh) return true;
    // Otherwise allow it if the blocker is further than the surface centre.
    return pick.distance > Vector3.Distance(eye, surface.worldCentre) - 0.4;
  }
}
