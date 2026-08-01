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

  /** Nearest surface whose face the player is roughly in front of. */
  nearest(position: Vector3, maxDistance = 3.2): PaintableSurface | null {
    let best: PaintableSurface | null = null;
    let bestDistance = maxDistance;
    for (const surface of this.surfaces.values()) {
      const distance = Vector3.Distance(position, surface.worldCentre);
      if (distance >= bestDistance) continue;
      const toPlayer = position.subtract(surface.worldCentre).normalize();
      if (Vector3.Dot(toPlayer, surface.normal) < 0.2) continue;
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
