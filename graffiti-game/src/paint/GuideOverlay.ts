import { Color3 } from "@babylonjs/core/Maths/math.color";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import type { Scene } from "@babylonjs/core/scene";

import type { ResampledStroke } from "./GuidedArtworks";
import type { PaintableSurface } from "./PaintableSurface";

const TEXTURE_EDGE = 1024;

/** Where the artwork sits on a surface, in that surface's 0..1 UV space. */
export interface ArtworkPlacement {
  /** Centre of the artwork box, in surface UV. */
  u: number;
  v: number;
  /** Half-extents of the artwork box, in surface UV. */
  halfU: number;
  halfV: number;
}

/**
 * The follow-along lines drawn on the wall.
 *
 * A separate plane a few millimetres in front of the paint layer, so the guide
 * never becomes part of the artwork — only the player's own spray is baked into
 * the surface. It is redrawn when progress changes rather than every frame.
 */
export class GuideOverlay {
  private readonly mesh: Mesh;
  private readonly texture: DynamicTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly material: StandardMaterial;
  private readonly width: number;
  private readonly height: number;
  private dashPhase = 0;

  constructor(scene: Scene, surface: PaintableSurface) {
    const aspect = surface.worldWidth / surface.worldHeight;
    this.width = aspect >= 1 ? TEXTURE_EDGE : Math.round(TEXTURE_EDGE * aspect);
    this.height = aspect >= 1 ? Math.round(TEXTURE_EDGE / aspect) : TEXTURE_EDGE;

    this.texture = new DynamicTexture(
      `guide.${surface.id}`,
      { width: this.width, height: this.height },
      scene,
      true,
    );
    this.texture.hasAlpha = true;
    this.ctx = this.texture.getContext() as unknown as CanvasRenderingContext2D;

    this.material = new StandardMaterial(`guideMat.${surface.id}`, scene);
    this.material.diffuseTexture = this.texture;
    this.material.useAlphaFromDiffuseTexture = true;
    this.material.disableLighting = true;
    // The guide must read in a dark alley without lighting it up like a sign.
    this.material.emissiveColor = new Color3(1, 1, 1);
    this.material.backFaceCulling = true;
    this.material.zOffset = -6;

    this.mesh = MeshBuilder.CreatePlane(
      `guidePlane.${surface.id}`,
      { width: surface.worldWidth, height: surface.worldHeight, sideOrientation: Mesh.FRONTSIDE },
      scene,
    );
    this.mesh.material = this.material;
    this.mesh.rotation.copyFrom(surface.mesh.rotation);
    this.mesh.position = surface.worldCentre.add(surface.normal.scale(0.012));
    this.mesh.isPickable = false;
    this.mesh.receiveShadows = false;
    this.mesh.renderingGroupId = 1;
  }

  setVisible(visible: boolean): void {
    this.mesh.setEnabled(visible);
  }

  /**
   * Redraws the guide.
   *
   * Three states are visually distinct on purpose: what you have already
   * painted, the short segment you are working on right now, and what is still
   * to come. Without that split it is impossible to tell where to resume after
   * a pause.
   */
  render(
    strokes: ResampledStroke[],
    placement: ArtworkPlacement,
    strokeIndex: number,
    distanceAlong: number,
    deltaSeconds: number,
  ): void {
    this.dashPhase = (this.dashPhase + deltaSeconds * 26) % 24;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    const toCanvas = (x: number, y: number): [number, number] => {
      // Artwork space (y up) -> surface UV -> canvas pixels (y down).
      const u = placement.u + (x - 0.5) * placement.halfU * 2;
      const v = placement.v + (y - 0.5) * placement.halfV * 2;
      return [u * this.width, (1 - v) * this.height];
    };

    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    strokes.forEach((stroke, index) => {
      const done = index < strokeIndex;
      const active = index === strokeIndex;

      const drawRange = (from: number, to: number, style: string, lineWidth: number, dashed: boolean) => {
        if (to - from < 1e-4) return;
        ctx.save();
        ctx.strokeStyle = style;
        ctx.lineWidth = lineWidth;
        if (dashed) {
          ctx.setLineDash([14, 10]);
          ctx.lineDashOffset = -this.dashPhase;
        }
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < stroke.points.length; i += 1) {
          const length = stroke.lengths[i];
          if (length < from || length > to) continue;
          const [px, py] = toCanvas(stroke.points[i][0], stroke.points[i][1]);
          if (!started) {
            ctx.moveTo(px, py);
            started = true;
          } else {
            ctx.lineTo(px, py);
          }
        }
        ctx.stroke();
        ctx.restore();
      };

      if (done) {
        drawRange(0, stroke.total, "rgba(53,224,196,0.55)", 5, false);
        return;
      }
      if (!active) {
        drawRange(0, stroke.total, "rgba(220,230,255,0.22)", 4, true);
        return;
      }

      // Active stroke: painted part, the live head, then the rest.
      drawRange(0, distanceAlong, "rgba(53,224,196,0.8)", 6, false);
      drawRange(distanceAlong, stroke.total, "rgba(220,230,255,0.4)", 4, true);

      // The head marker: where the can should be right now.
      const head = sampleHead(stroke, distanceAlong);
      const [hx, hy] = toCanvas(head.x, head.y);
      ctx.save();
      ctx.strokeStyle = "#ff3d7f";
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(hx, hy, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,61,127,0.35)";
      ctx.fill();
      ctx.restore();
    });

    this.texture.update();
  }

  dispose(): void {
    this.mesh.dispose(false, true);
    this.texture.dispose();
    this.material.dispose();
  }
}

function sampleHead(stroke: ResampledStroke, distance: number): { x: number; y: number } {
  if (stroke.points.length === 0) return { x: 0, y: 0 };
  let index = 0;
  while (index < stroke.lengths.length - 1 && stroke.lengths[index] < distance) index += 1;
  const point = stroke.points[index];
  return { x: point[0], y: point[1] };
}
