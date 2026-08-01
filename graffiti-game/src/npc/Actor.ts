import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

export interface ActorLook {
  coat: string;
  trousers: string;
  skin: string;
  accent?: string;
  height?: number;
}

/**
 * Shared body for every NPC.
 *
 * Deliberately blocky: a few boxes with swinging limbs read as a person at
 * alley distances and in this lighting, and they cost a fraction of a rigged
 * character. The important part for gameplay is the eye position and facing,
 * which is what the vision checks use.
 */
export class Actor {
  readonly root: TransformNode;
  readonly parts: Mesh[] = [];

  protected readonly legs: [Mesh, Mesh];
  protected readonly arms: [Mesh, Mesh];
  protected readonly head: Mesh;

  private walkPhase = 0;
  private facing = 0;
  readonly eyeHeight: number;

  /** Straight-line speed in m/s the actor is currently trying to hit. */
  speed = 1.35;

  constructor(
    protected readonly scene: Scene,
    name: string,
    look: ActorLook,
    position: Vector3,
  ) {
    const height = look.height ?? 1.78;
    this.eyeHeight = height * 0.92;

    this.root = new TransformNode(name, scene);
    this.root.position.copyFrom(position);

    const coat = this.material(`${name}.coat`, look.coat);
    const trousers = this.material(`${name}.trousers`, look.trousers);
    const skin = this.material(`${name}.skin`, look.skin);

    const torso = MeshBuilder.CreateBox(
      `${name}.torso`,
      { width: 0.46, height: height * 0.34, depth: 0.26 },
      scene,
    );
    torso.parent = this.root;
    torso.position.y = height * 0.63;
    torso.material = coat;
    this.parts.push(torso);

    this.head = MeshBuilder.CreateBox(`${name}.head`, { width: 0.22, height: 0.25, depth: 0.23 }, scene);
    this.head.parent = this.root;
    this.head.position.y = height * 0.9;
    this.head.material = skin;
    this.parts.push(this.head);

    if (look.accent) {
      const hat = MeshBuilder.CreateBox(`${name}.hat`, { width: 0.25, height: 0.09, depth: 0.26 }, scene);
      hat.parent = this.root;
      hat.position.y = height * 0.99;
      hat.material = this.material(`${name}.hat`, look.accent);
      this.parts.push(hat);
      // Peak, so the silhouette reads as a cap from behind too.
      const peak = MeshBuilder.CreateBox(`${name}.peak`, { width: 0.24, height: 0.03, depth: 0.12 }, scene);
      peak.parent = this.root;
      peak.position.set(0, height * 0.96, -0.17);
      peak.material = this.material(`${name}.hat`, look.accent);
      this.parts.push(peak);
    }

    const makeLimb = (suffix: string, x: number, y: number, size: { w: number; h: number }, mat: StandardMaterial) => {
      const limb = MeshBuilder.CreateBox(`${name}.${suffix}`, { width: size.w, height: size.h, depth: 0.16 }, scene);
      limb.parent = this.root;
      limb.position.set(x, y, 0);
      limb.setPivotPoint(new Vector3(0, size.h / 2, 0));
      limb.material = mat;
      this.parts.push(limb);
      return limb;
    };

    const legHeight = height * 0.44;
    this.legs = [
      makeLimb("legL", -0.12, legHeight / 2, { w: 0.16, h: legHeight }, trousers),
      makeLimb("legR", 0.12, legHeight / 2, { w: 0.16, h: legHeight }, trousers),
    ];
    const armHeight = height * 0.32;
    this.arms = [
      makeLimb("armL", -0.3, height * 0.66, { w: 0.13, h: armHeight }, coat),
      makeLimb("armR", 0.3, height * 0.66, { w: 0.13, h: armHeight }, coat),
    ];

    for (const part of this.parts) {
      part.isPickable = false;
      part.receiveShadows = true;
    }
  }

  get position(): Vector3 {
    return this.root.position;
  }

  get eyePosition(): Vector3 {
    return this.root.position.add(new Vector3(0, this.eyeHeight, 0));
  }

  get forward(): Vector3 {
    return new Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
  }

  setVisible(visible: boolean): void {
    for (const part of this.parts) part.setEnabled(visible);
  }

  /** Steers towards a world point, animating the walk cycle as it goes. */
  moveTowards(target: Vector3, deltaSeconds: number, speed = this.speed): boolean {
    const offset = target.subtract(this.root.position);
    offset.y = 0;
    const distance = offset.length();
    if (distance < 0.001) return true;

    const direction = offset.scale(1 / distance);
    const step = Math.min(distance, speed * deltaSeconds);
    const next = this.root.position.add(direction.scale(step));

    // Cheap obstacle avoidance: if something solid is dead ahead, slide along it.
    if (this.blocked(direction, 0.7)) {
      const sidestep = new Vector3(-direction.z, 0, direction.x);
      const sign = this.blocked(sidestep, 0.8) ? -1 : 1;
      next.copyFrom(this.root.position.add(sidestep.scale(sign * speed * deltaSeconds)));
    }

    this.root.position.copyFrom(next);
    this.faceDirection(direction, deltaSeconds);
    this.animateWalk(deltaSeconds, speed);
    return distance <= Math.max(0.35, speed * deltaSeconds * 1.5);
  }

  faceDirection(direction: Vector3, deltaSeconds: number, rate = 8): void {
    const target = Math.atan2(direction.x, direction.z);
    let delta = target - this.facing;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.facing += delta * Math.min(1, deltaSeconds * rate);
    this.root.rotation.y = this.facing;
  }

  lookAt(point: Vector3, deltaSeconds: number): void {
    const direction = point.subtract(this.root.position);
    direction.y = 0;
    if (direction.lengthSquared() > 1e-5) this.faceDirection(direction.normalize(), deltaSeconds, 6);
  }

  /** Idle sway, so a stationary NPC does not look like a mannequin. */
  animateIdle(deltaSeconds: number): void {
    this.walkPhase += deltaSeconds * 1.6;
    const sway = Math.sin(this.walkPhase) * 0.03;
    this.legs[0].rotation.x = sway * 0.2;
    this.legs[1].rotation.x = -sway * 0.2;
    this.arms[0].rotation.x = sway;
    this.arms[1].rotation.x = -sway;
    this.head.rotation.y = Math.sin(this.walkPhase * 0.5) * 0.35;
  }

  protected animateWalk(deltaSeconds: number, speed: number): void {
    this.walkPhase += deltaSeconds * (3.4 + speed * 1.3);
    const swing = Math.sin(this.walkPhase) * Scalar.Clamp(speed / 2.4, 0.25, 1) * 0.75;
    this.legs[0].rotation.x = swing;
    this.legs[1].rotation.x = -swing;
    this.arms[0].rotation.x = -swing * 0.8;
    this.arms[1].rotation.x = swing * 0.8;
    this.head.rotation.y = 0;
  }

  /** Can this actor see the given point, given its facing cone? */
  canSee(point: Vector3, range: number, halfAngleRadians: number): boolean {
    const offset = point.subtract(this.eyePosition);
    const distance = offset.length();
    if (distance > range) return false;
    const direction = offset.scale(1 / distance);
    const flat = new Vector3(direction.x, 0, direction.z);
    if (flat.lengthSquared() < 1e-6) return false;
    flat.normalize();
    if (Vector3.Dot(flat, this.forward) < Math.cos(halfAngleRadians)) return false;
    return this.hasLineOfSight(point);
  }

  hasLineOfSight(point: Vector3): boolean {
    const origin = this.eyePosition;
    const offset = point.subtract(origin);
    const distance = offset.length();
    if (distance < 0.001) return true;
    const ray = new Ray(origin, offset.scale(1 / distance), distance - 0.2);
    const hit = this.scene.pickWithRay(ray, (mesh: AbstractMesh) => mesh.checkCollisions && mesh.isVisible);
    return !hit?.hit;
  }

  private blocked(direction: Vector3, distance: number): boolean {
    const ray = new Ray(this.root.position.add(new Vector3(0, 0.9, 0)), direction, distance);
    const hit = this.scene.pickWithRay(ray, (mesh: AbstractMesh) => mesh.checkCollisions);
    return Boolean(hit?.hit);
  }

  protected material(name: string, hex: string, emissive = 0): StandardMaterial {
    const existing = this.scene.getMaterialByName(name);
    if (existing instanceof StandardMaterial) return existing;
    const material = new StandardMaterial(name, this.scene);
    const colour = Color3.FromHexString(hex);
    material.diffuseColor = colour;
    material.emissiveColor = colour.scale(emissive);
    material.specularColor = new Color3(0.05, 0.05, 0.06);
    return material;
  }

  dispose(): void {
    for (const part of this.parts) part.dispose();
    this.root.dispose();
  }
}
