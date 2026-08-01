import { Color3 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import { makeRandom } from "../world/ProceduralTextures";
import { drawStencil, stencilById } from "./Stencils";
import { scorePiece, type PieceScore } from "./PaintScoring";
import { q, type SerializedSurface, type StrokeOp } from "./StrokeTypes";

export interface SurfaceDef {
  id: string;
  /** Shown in the HUD when the player looks at it. */
  label: string;
  /** Centre of the paintable area, in world space. */
  position: Vector3;
  /** Yaw in radians. The paint plane's +Z normal points this way. */
  rotationY: number;
  /** Metres. */
  width: number;
  height: number;
  /** 0..1 — how exposed the spot is. Drives fame multiplier and witness odds. */
  risk: number;
  /** Optional pitch, for surfaces that are not perfectly vertical. */
  rotationX?: number;
  /** Texture resolution per metre. Larger walls get capped automatically. */
  texelsPerMetre?: number;
}

const MAX_TEXTURE_EDGE = 1024;
const GRID_CELLS_ACROSS = 56;
/** Accumulated wetness in a single grid cell before the paint starts to run. */
const DRIP_THRESHOLD = 10;

interface LiveDrip {
  x: number;
  y: number;
  drawn: number;
  target: number;
  width: number;
  colour: string;
  speed: number;
}

/**
 * One paintable wall, shutter or panel.
 *
 * The mesh is a thin plane floated a couple of centimetres in front of the real
 * geometry and carrying its own `DynamicTexture`. All drawing happens in canvas
 * space; every mutation is also appended to an op list so the surface can be
 * rebuilt from a save file, undone, or replayed.
 */
export class PaintableSurface {
  readonly id: string;
  readonly label: string;
  readonly risk: number;
  readonly mesh: Mesh;
  readonly worldWidth: number;
  readonly worldHeight: number;

  // Allocated on first paint: the district has hundreds of paintable panels and
  // giving every one of them a megabyte of canvas up front would be absurd.
  private texture: DynamicTexture | null = null;
  private ctxOrNull: CanvasRenderingContext2D | null = null;
  private material: StandardMaterial | null = null;
  readonly texWidth: number;
  readonly texHeight: number;

  private readonly ops: StrokeOp[] = [];
  private readonly gridW: number;
  private readonly gridH: number;
  private readonly coverGrid: Uint8Array;
  /** Paint build-up per cell; a saturated cell starts running. */
  private readonly wetGrid: Float32Array;
  private coveredCells = 0;

  private readonly drips: LiveDrip[] = [];
  private readonly rng = makeRandom(0xc0ffee);

  private dirty = false;
  private sprayTicks = 0;
  private onTargetTicks = 0;
  private smoothnessAccum = 0;
  private smoothnessSamples = 0;
  private lastUV: { u: number; v: number } | null = null;
  private timeSpentMs = 0;

  finished = false;
  score: PieceScore | null = null;

  constructor(scene: Scene, def: SurfaceDef) {
    this.id = def.id;
    this.label = def.label;
    this.risk = def.risk;
    this.worldWidth = def.width;
    this.worldHeight = def.height;

    const perMetre = def.texelsPerMetre ?? 190;
    const aspect = def.width / def.height;
    let texWidth = Math.round(def.width * perMetre);
    let texHeight = Math.round(def.height * perMetre);
    const longest = Math.max(texWidth, texHeight);
    if (longest > MAX_TEXTURE_EDGE) {
      const scale = MAX_TEXTURE_EDGE / longest;
      texWidth = Math.round(texWidth * scale);
      texHeight = Math.round(texHeight * scale);
    }
    this.texWidth = Math.max(64, texWidth);
    this.texHeight = Math.max(64, texHeight);

    this.mesh = MeshBuilder.CreatePlane(
      `paintPlane.${def.id}`,
      { width: def.width, height: def.height, sideOrientation: Mesh.FRONTSIDE },
      scene,
    );
    // Invisible until painted, but always pickable — that is what lets the
    // cursor find a blank wall without the wall costing anything to exist.
    this.mesh.isVisible = false;
    this.mesh.position = def.position.clone();
    this.mesh.rotation.y = def.rotationY;
    if (def.rotationX) this.mesh.rotation.x = def.rotationX;
    this.mesh.isPickable = true;
    this.mesh.receiveShadows = false;
    this.mesh.metadata = { paintable: true, surfaceId: def.id };
    this.mesh.freezeWorldMatrix();

    this.gridW = GRID_CELLS_ACROSS;
    this.gridH = Math.max(6, Math.round(GRID_CELLS_ACROSS / Math.max(0.25, aspect)));
    this.coverGrid = new Uint8Array(this.gridW * this.gridH);
    this.wetGrid = new Float32Array(this.gridW * this.gridH);
  }

  /** Allocates the canvas and material the first time paint lands here. */
  private ensureCanvas(): CanvasRenderingContext2D {
    if (this.ctxOrNull) return this.ctxOrNull;

    const scene = this.mesh.getScene();
    this.texture = new DynamicTexture(
      `paint.${this.id}`,
      { width: this.texWidth, height: this.texHeight },
      scene,
      true,
    );
    this.texture.hasAlpha = true;
    this.texture.anisotropicFilteringLevel = 4;
    const ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;
    ctx.clearRect(0, 0, this.texWidth, this.texHeight);
    this.texture.update();

    this.material = new StandardMaterial(`paintMat.${this.id}`, scene);
    this.material.diffuseTexture = this.texture;
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.specularColor = new Color3(0.09, 0.09, 0.1);
    this.material.specularPower = 40;
    // Fresh paint has a faint sheen even in the dark; keeps it readable at night.
    this.material.emissiveColor = new Color3(0.06, 0.06, 0.07);
    this.material.backFaceCulling = true;
    this.material.zOffset = -2;

    this.mesh.material = this.material;
    this.mesh.isVisible = true;
    this.ctxOrNull = ctx;
    return ctx;
  }

  /** Canvas accessor for the drawing helpers, allocating on demand. */
  private get ctx(): CanvasRenderingContext2D {
    return this.ensureCanvas();
  }

  // ---------------------------------------------------------------- geometry

  /** World-space normal the plane faces. */
  get normal(): Vector3 {
    const forward = new Vector3(0, 0, -1);
    return Vector3.TransformNormal(forward, this.mesh.getWorldMatrix()).normalize();
  }

  get worldCentre(): Vector3 {
    return this.mesh.position;
  }

  // ----------------------------------------------------------------- drawing

  /**
   * Lays down spray at a UV point, joining it to the previous point of the same
   * stroke so fast mouse movement does not leave a dotted line.
   *
   * @param u,v         hit point in 0..1 texture space
   * @param radiusPx    brush radius in texels
   * @param colour      CSS colour
   * @param alpha       per-tick opacity (already scaled by flow and pressure)
   * @param scatter     0..1 overspray amount
   * @param continuous  false when the trigger was just pulled
   */
  spray(
    u: number,
    v: number,
    radiusPx: number,
    colour: string,
    alpha: number,
    scatter: number,
    continuous: boolean,
  ): void {
    const x = u * this.texWidth;
    const y = (1 - v) * this.texHeight;
    const ctx = this.ensureCanvas();

    if (continuous && this.lastUV) {
      const px = this.lastUV.u * this.texWidth;
      const py = (1 - this.lastUV.v) * this.texHeight;
      const distance = Math.hypot(x - px, y - py);
      // Track how steady the hand is: small, even steps score well.
      this.smoothnessAccum += Math.exp(-distance / (radiusPx * 2.6 + 8));
      this.smoothnessSamples += 1;

      this.strokeSegment(px, py, x, y, radiusPx, colour, alpha);
      this.ops.push({
        k: "l",
        x0: q(px),
        y0: q(py),
        x1: q(x),
        y1: q(y),
        r: q(radiusPx),
        c: colour,
        a: Math.round(alpha * 100) / 100,
      });
    } else {
      this.dab(x, y, radiusPx, colour, alpha);
      this.ops.push({
        k: "d",
        x: q(x),
        y: q(y),
        r: q(radiusPx),
        c: colour,
        a: Math.round(alpha * 100) / 100,
      });
    }

    if (scatter > 0) this.speckle(ctx, x, y, radiusPx * (1.5 + scatter), colour, alpha * 0.35, scatter);

    this.markCoverage(x, y, radiusPx);
    this.accumulateWetness(x, y, radiusPx, alpha, colour);

    this.lastUV = { u, v };
    this.dirty = true;
    this.sprayTicks += 1;
    this.onTargetTicks += 1;
  }

  /** Called when the reticle drifts off the surface — counts as overspray. */
  noteOverspray(): void {
    this.sprayTicks += 1;
    this.lastUV = null;
  }

  /** Ends the current stroke so the next dab does not connect to a stale point. */
  breakStroke(): void {
    this.lastUV = null;
  }

  stamp(stencilId: string, u: number, v: number, sizePx: number, rotation: number, colour: string): boolean {
    const stencil = stencilById(stencilId);
    if (!stencil) return false;
    this.ensureCanvas();
    const width = sizePx * stencil.aspect;
    const height = sizePx;
    const x = u * this.texWidth;
    const y = (1 - v) * this.texHeight;
    drawStencil(this.ctx, stencil, x, y, width, height, rotation, colour);
    this.ops.push({
      k: "s",
      id: stencilId,
      x: q(x),
      y: q(y),
      w: q(width),
      h: q(height),
      rot: Math.round(rotation * 100) / 100,
      c: colour,
    });
    this.markCoverage(x, y, Math.max(width, height) * 0.42);
    this.dirty = true;
    this.lastUV = null;
    return true;
  }

  /** Grey wash used both by the buff truck and by the player's own base coat. */
  buff(colour = "#6f6f6c", alpha = 0.92): void {
    this.ensureCanvas();
    this.ctx.save();
    this.ctx.globalAlpha = alpha;
    this.ctx.fillStyle = colour;
    this.ctx.fillRect(0, 0, this.texWidth, this.texHeight);
    this.ctx.restore();
    this.ops.push({ k: "f", c: colour, a: Math.round(alpha * 100) / 100 });
    this.coverGrid.fill(1);
    this.coveredCells = this.coverGrid.length;
    this.wetGrid.fill(0);
    this.drips.length = 0;
    this.dirty = true;
    this.lastUV = null;
  }

  /** Removes the last op and rebuilds. Cheap enough at our op counts. */
  undo(): boolean {
    if (this.ops.length === 0) return false;
    this.ops.pop();
    this.rebuild([...this.ops]);
    return true;
  }

  clear(): void {
    this.ops.length = 0;
    this.rebuild([]);
    this.finished = false;
    this.score = null;
    this.timeSpentMs = 0;
    this.sprayTicks = 0;
    this.onTargetTicks = 0;
    this.smoothnessAccum = 0;
    this.smoothnessSamples = 0;
  }

  // ------------------------------------------------------------- simulation

  /** Advances drips and pushes the canvas to the GPU at most once a frame. */
  update(deltaSeconds: number, isPainting: boolean): void {
    if (isPainting) this.timeSpentMs += deltaSeconds * 1000;
    if (!this.ctxOrNull) return;

    if (this.drips.length > 0) {
      const ctx = this.ctx;
      for (let i = this.drips.length - 1; i >= 0; i -= 1) {
        const drip = this.drips[i];
        const step = Math.min(drip.speed * deltaSeconds, drip.target - drip.drawn);
        if (step > 0.2) {
          ctx.save();
          ctx.globalAlpha = 0.85;
          ctx.strokeStyle = drip.colour;
          ctx.lineCap = "round";
          // The trail thins as the drip runs out of paint.
          const progress = drip.drawn / drip.target;
          ctx.lineWidth = Math.max(0.8, drip.width * (1 - progress * 0.75));
          ctx.beginPath();
          ctx.moveTo(drip.x, drip.y + drip.drawn);
          ctx.lineTo(drip.x, drip.y + drip.drawn + step);
          ctx.stroke();
          ctx.restore();
          drip.drawn += step;
          this.dirty = true;
        }
        if (drip.drawn >= drip.target - 0.2) {
          // A bead of paint gathers at the tip before it stops.
          this.dab(drip.x, drip.y + drip.target, drip.width * 0.8, drip.colour, 0.7);
          this.ops.push({
            k: "p",
            x: q(drip.x),
            y: q(drip.y),
            len: q(drip.target),
            w: q(drip.width),
            c: drip.colour,
          });
          this.markCoverage(drip.x, drip.y + drip.target * 0.5, drip.width);
          this.drips.splice(i, 1);
          this.dirty = true;
        }
      }
    }

    if (this.dirty) {
      this.texture?.update();
      this.dirty = false;
    }
  }

  // ---------------------------------------------------------------- scoring

  get coverage(): number {
    return this.coveredCells / this.coverGrid.length;
  }

  get opCount(): number {
    return this.ops.length;
  }

  get hasPaint(): boolean {
    return this.ops.length > 0;
  }

  get activeDripCount(): number {
    return this.drips.length;
  }

  /** Freezes the piece and produces its rating. */
  commit(): PieceScore {
    const smoothness =
      this.smoothnessSamples > 0 ? this.smoothnessAccum / this.smoothnessSamples : 0.5;
    const onTarget = this.sprayTicks > 0 ? this.onTargetTicks / this.sprayTicks : 1;
    this.score = scorePiece({
      ops: this.ops,
      coverage: this.coverage,
      onTargetRatio: onTarget,
      smoothness,
      risk: this.risk,
      timeSpentMs: this.timeSpentMs,
    });
    this.finished = true;
    return this.score;
  }

  /** Re-opens a committed piece so the player can add to it. */
  reopen(): void {
    this.finished = false;
  }

  // ------------------------------------------------------------ persistence

  serialize(): SerializedSurface {
    return {
      ops: this.ops,
      score: this.score ?? undefined,
      timeSpentMs: Math.round(this.timeSpentMs),
      finished: this.finished,
    };
  }

  restore(data: SerializedSurface | undefined): void {
    if (!data) return;
    this.rebuild(Array.isArray(data.ops) ? data.ops : []);
    this.timeSpentMs = data.timeSpentMs ?? 0;
    this.finished = Boolean(data.finished);
    this.score = data.score ?? null;
    // Replayed strokes have no live input history, so credit a neutral hand.
    this.smoothnessAccum = 0.72;
    this.smoothnessSamples = 1;
    this.sprayTicks = this.ops.length;
    this.onTargetTicks = this.ops.length;
  }

  dispose(): void {
    this.mesh.dispose(false, true);
    this.texture?.dispose();
    this.material?.dispose();
  }

  // ----------------------------------------------------------------- private

  private rebuild(ops: StrokeOp[]): void {
    if (ops.length === 0 && !this.ctxOrNull) {
      // Nothing drawn and nothing allocated: there is no canvas to reset.
      this.ops.length = 0;
      this.coverGrid.fill(0);
      this.wetGrid.fill(0);
      this.coveredCells = 0;
      this.drips.length = 0;
      return;
    }
    this.ensureCanvas().clearRect(0, 0, this.texWidth, this.texHeight);
    this.coverGrid.fill(0);
    this.wetGrid.fill(0);
    this.coveredCells = 0;
    this.drips.length = 0;
    this.ops.length = 0;

    for (const op of ops) {
      switch (op.k) {
        case "d":
          this.dab(op.x, op.y, op.r, op.c, op.a);
          this.markCoverage(op.x, op.y, op.r);
          break;
        case "l":
          this.strokeSegment(op.x0, op.y0, op.x1, op.y1, op.r, op.c, op.a);
          this.markCoverage(op.x1, op.y1, op.r);
          break;
        case "p":
          this.drawFinishedDrip(op.x, op.y, op.len, op.w, op.c);
          this.markCoverage(op.x, op.y + op.len * 0.5, op.w);
          break;
        case "s": {
          const stencil = stencilById(op.id);
          if (stencil) {
            drawStencil(this.ctx, stencil, op.x, op.y, op.w, op.h, op.rot, op.c);
            this.markCoverage(op.x, op.y, Math.max(op.w, op.h) * 0.42);
          }
          break;
        }
        case "f":
          this.ctx.save();
          this.ctx.globalAlpha = op.a;
          this.ctx.fillStyle = op.c;
          this.ctx.fillRect(0, 0, this.texWidth, this.texHeight);
          this.ctx.restore();
          this.coverGrid.fill(1);
          this.coveredCells = this.coverGrid.length;
          break;
      }
      this.ops.push(op);
    }

    this.texture?.update();
    this.dirty = false;
    this.lastUV = null;
  }

  private dab(x: number, y: number, radius: number, colour: string, alpha: number): void {
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, Math.max(1, radius));
    // A hard-ish core with a short feathered edge: a spray cone, not an
    // airbrush. Pure linear falloff makes every stroke look like a halo.
    gradient.addColorStop(0, withAlpha(colour, alpha));
    gradient.addColorStop(0.62, withAlpha(colour, alpha * 0.9));
    gradient.addColorStop(0.85, withAlpha(colour, alpha * 0.42));
    gradient.addColorStop(1, withAlpha(colour, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1, radius), 0, Math.PI * 2);
    ctx.fill();
  }

  private strokeSegment(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    radius: number,
    colour: string,
    alpha: number,
  ): void {
    const distance = Math.hypot(x1 - x0, y1 - y0);
    // Step along the segment so the soft gradient stays even at any speed.
    const step = Math.max(1, radius * 0.35);
    const count = Math.min(64, Math.max(1, Math.ceil(distance / step)));
    // Spread the tick's opacity across the sub-dabs, otherwise fast drags
    // deposit far more paint than slow ones.
    const perDab = alpha / Math.sqrt(count);
    for (let i = 0; i <= count; i += 1) {
      const t = count === 0 ? 0 : i / count;
      this.dab(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, radius, colour, perDab);
    }
  }

  private speckle(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    colour: string,
    alpha: number,
    scatter: number,
  ): void {
    const count = Math.round(4 + scatter * 10);
    ctx.save();
    ctx.fillStyle = colour;
    for (let i = 0; i < count; i += 1) {
      const angle = this.rng() * Math.PI * 2;
      const distance = Math.sqrt(this.rng()) * radius;
      ctx.globalAlpha = alpha * (0.25 + this.rng() * 0.75);
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, 0.5 + this.rng() * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFinishedDrip(x: number, y: number, length: number, width: number, colour: string): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = colour;
    ctx.lineCap = "round";
    const segments = 8;
    for (let i = 0; i < segments; i += 1) {
      const t0 = i / segments;
      const t1 = (i + 1) / segments;
      ctx.lineWidth = Math.max(0.8, width * (1 - t0 * 0.75));
      ctx.beginPath();
      ctx.moveTo(x, y + length * t0);
      ctx.lineTo(x, y + length * t1);
      ctx.stroke();
    }
    ctx.restore();
    this.dab(x, y + length, width * 0.8, colour, 0.7);
  }

  private markCoverage(x: number, y: number, radius: number): void {
    const cellW = this.texWidth / this.gridW;
    const cellH = this.texHeight / this.gridH;
    const minX = Math.max(0, Math.floor((x - radius * 0.6) / cellW));
    const maxX = Math.min(this.gridW - 1, Math.floor((x + radius * 0.6) / cellW));
    const minY = Math.max(0, Math.floor((y - radius * 0.6) / cellH));
    const maxY = Math.min(this.gridH - 1, Math.floor((y + radius * 0.6) / cellH));
    for (let gy = minY; gy <= maxY; gy += 1) {
      for (let gx = minX; gx <= maxX; gx += 1) {
        const index = gy * this.gridW + gx;
        if (this.coverGrid[index] === 0) {
          this.coverGrid[index] = 1;
          this.coveredCells += 1;
        }
      }
    }
  }

  /**
   * Tracks how much paint has piled up in one spot. Hold the can still and the
   * wall gets saturated, which is exactly when real paint starts to run.
   */
  private accumulateWetness(x: number, y: number, radius: number, alpha: number, colour: string): void {
    const cellW = this.texWidth / this.gridW;
    const cellH = this.texHeight / this.gridH;
    const gx = Math.max(0, Math.min(this.gridW - 1, Math.floor(x / cellW)));
    const gy = Math.max(0, Math.min(this.gridH - 1, Math.floor(y / cellH)));
    const index = gy * this.gridW + gx;
    this.wetGrid[index] += alpha * (radius / 24);

    // Threshold tuned so a standard cap held still on one spot starts running
    // after roughly a second and a half — long enough to be a choice, short
    // enough that resting on a fill has a visible cost.
    if (this.wetGrid[index] > DRIP_THRESHOLD && this.drips.length < 12) {
      this.wetGrid[index] = 0;
      this.drips.push({
        x: x + (this.rng() - 0.5) * radius * 0.6,
        y,
        drawn: 0,
        target: radius * (1.6 + this.rng() * 5.5),
        width: Math.max(1.6, radius * (0.16 + this.rng() * 0.16)),
        colour,
        speed: 22 + this.rng() * 46,
      });
    }

    // Everything else dries a little, so wandering the can around avoids runs.
    for (let i = 0; i < this.wetGrid.length; i += 1) {
      if (i !== index && this.wetGrid[i] > 0) this.wetGrid[i] *= 0.995;
    }
  }
}

/** Applies an alpha to a `#rrggbb` colour without touching the canvas state. */
function withAlpha(hex: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  if (hex.startsWith("#") && hex.length === 7) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${clamped})`;
  }
  return hex;
}
