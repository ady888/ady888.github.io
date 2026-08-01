import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

import { PaintableSurface, type SurfaceDef } from "./PaintableSurface";
import type { SerializedSurface } from "./StrokeTypes";

/** Owns every paintable surface in the district and the lookups over them. */
export class SurfaceManager {
  private readonly surfaces = new Map<string, PaintableSurface>();

  constructor(scene: Scene, defs: SurfaceDef[]) {
    for (const def of defs) {
      this.surfaces.set(def.id, new PaintableSurface(scene, def));
    }
  }

  get all(): PaintableSurface[] {
    return [...this.surfaces.values()];
  }

  get(id: string): PaintableSurface | undefined {
    return this.surfaces.get(id);
  }

  fromMesh(mesh: AbstractMesh | null | undefined): PaintableSurface | undefined {
    const id = mesh?.metadata?.surfaceId as string | undefined;
    return id ? this.surfaces.get(id) : undefined;
  }

  /** Every surface carrying at least one stroke. */
  get painted(): PaintableSurface[] {
    return this.all.filter((surface) => surface.hasPaint);
  }

  get finishedCount(): number {
    return this.all.filter((surface) => surface.finished).length;
  }

  /**
   * Nearest surface the player is standing in front of.
   *
   * Measured horizontally, to the panel's footprint rather than to its centre.
   * A centre-to-centre test is wrong twice over for a wall panel hung 2 m up:
   * it inflates the distance by the height offset (so a wall 4 m away reads as
   * 5 m and fails the range check), and the centre-to-player vector points
   * steeply downwards when you walk right up to it, so the facing test rejects
   * you exactly when you are closest. That combination left only a narrow band
   * where a wall could be selected at all — which is why pressing P at a wall
   * so often did nothing.
   */
  nearest(position: Vector3, maxDistance = 3.2): PaintableSurface | null {
    let best: PaintableSurface | null = null;
    let bestDistance = maxDistance;

    for (const surface of this.surfaces.values()) {
      const centre = surface.worldCentre;
      const normal = surface.normal;

      // Horizontal axis along the face, so we can clamp to the panel's width.
      const along = new Vector3(-normal.z, 0, normal.x);
      const offset = position.subtract(centre);
      const lateral = offset.x * along.x + offset.z * along.z;
      const depth = offset.x * normal.x + offset.z * normal.z;

      // Must be on the painted side, not behind the wall.
      if (depth < 0.05) continue;

      // How far past either end of the panel the player is standing; zero when
      // they are somewhere along its width.
      const half = surface.worldWidth / 2;
      const overhang = lateral - Scalar.Clamp(lateral, -half, half);
      const distance = Math.hypot(depth, overhang);
      if (distance >= bestDistance) continue;

      // Prefer the panel you are square-on to when several are in range.
      best = surface;
      bestDistance = distance;
    }
    return best;
  }

  update(deltaSeconds: number, activeId: string | null): void {
    for (const surface of this.surfaces.values()) {
      surface.update(deltaSeconds, surface.id === activeId);
    }
  }

  serialize(): Record<string, SerializedSurface> {
    const out: Record<string, SerializedSurface> = {};
    for (const [id, surface] of this.surfaces) {
      if (surface.hasPaint) out[id] = surface.serialize();
    }
    return out;
  }

  restore(data: Record<string, SerializedSurface> | undefined): void {
    if (!data) return;
    for (const [id, entry] of Object.entries(data)) {
      this.surfaces.get(id)?.restore(entry);
    }
  }

  clearAll(): void {
    for (const surface of this.surfaces.values()) surface.clear();
  }

  dispose(): void {
    for (const surface of this.surfaces.values()) surface.dispose();
    this.surfaces.clear();
  }
}
