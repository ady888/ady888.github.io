import { HavokPlugin } from "@babylonjs/core/Physics/v2/Plugins/havokPlugin";
import { PhysicsAggregate } from "@babylonjs/core/Physics/v2/physicsAggregate";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

import "@babylonjs/core/Physics/physicsEngineComponent";

/**
 * Havok integration.
 *
 * The player deliberately does *not* run on Havok — a swept-ellipsoid character
 * gives tighter, more predictable movement for a game where you spend your time
 * lining up against walls. Havok instead owns the loose junk in the alley: bins,
 * bottles, cans and pallets that scatter when you barge through them, which is
 * both the readable use of a rigid-body solver and the part that survives being
 * switched off if the WASM module cannot load.
 */
export class PhysicsWorld {
  private plugin: HavokPlugin | null = null;
  private readonly dynamicBodies: PhysicsAggregate[] = [];

  get enabled(): boolean {
    return this.plugin !== null;
  }

  async init(scene: Scene): Promise<boolean> {
    try {
      const [{ default: HavokPhysics }, wasm] = await Promise.all([
        import("@babylonjs/havok"),
        import("@babylonjs/havok/lib/esm/HavokPhysics.wasm?url"),
      ]);
      const havok = await HavokPhysics({ locateFile: () => wasm.default });
      this.plugin = new HavokPlugin(true, havok);
      scene.enablePhysics(new Vector3(0, -9.81, 0), this.plugin);
      return true;
    } catch (error) {
      console.warn(
        "[PhysicsWorld] Havok unavailable — loose props will stay put, everything else is unaffected.",
        error,
      );
      this.plugin = null;
      return false;
    }
  }

  /** Registers a mesh as immovable collision geometry (walls, ground, crates). */
  addStatic(mesh: AbstractMesh, shape: PhysicsShapeType = PhysicsShapeType.BOX): void {
    if (!this.plugin) return;
    try {
      new PhysicsAggregate(mesh, shape, { mass: 0, restitution: 0.05, friction: 0.8 }, mesh.getScene());
    } catch (error) {
      console.warn("[PhysicsWorld] failed to add static body", mesh.name, error);
    }
  }

  /** Registers a mesh that can be knocked around. */
  addDynamic(
    mesh: AbstractMesh,
    mass: number,
    shape: PhysicsShapeType = PhysicsShapeType.BOX,
    options: { restitution?: number; friction?: number } = {},
  ): PhysicsAggregate | null {
    if (!this.plugin) return null;
    try {
      const aggregate = new PhysicsAggregate(
        mesh,
        shape,
        {
          mass,
          restitution: options.restitution ?? 0.25,
          friction: options.friction ?? 0.55,
        },
        mesh.getScene(),
      );
      aggregate.body.setLinearDamping(0.35);
      aggregate.body.setAngularDamping(0.7);
      this.dynamicBodies.push(aggregate);
      return aggregate;
    } catch (error) {
      console.warn("[PhysicsWorld] failed to add dynamic body", mesh.name, error);
      return null;
    }
  }

  /**
   * Shoves nearby loose props away from a point — how the player kicks through
   * rubbish without needing a rigid body of their own.
   */
  nudge(origin: Vector3, radius: number, strength: number): void {
    if (!this.plugin) return;
    const radiusSquared = radius * radius;
    for (const aggregate of this.dynamicBodies) {
      const mesh = aggregate.transformNode;
      const offset = mesh.getAbsolutePosition().subtract(origin);
      offset.y = Math.max(offset.y, 0.05);
      if (offset.lengthSquared() > radiusSquared) continue;
      const impulse = offset.normalize().scale(strength);
      impulse.y = Math.abs(impulse.y) * 0.4 + strength * 0.12;
      aggregate.body.applyImpulse(impulse, mesh.getAbsolutePosition());
    }
  }

  dispose(): void {
    for (const aggregate of this.dynamicBodies) aggregate.dispose();
    this.dynamicBodies.length = 0;
    this.plugin?.dispose();
    this.plugin = null;
  }
}
