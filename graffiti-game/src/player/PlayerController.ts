import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import "@babylonjs/core/Collisions/collisionCoordinator";
import "@babylonjs/core/Culling/ray";

import type { InputManager } from "../core/InputManager";
import type { GameSettings } from "../core/Settings";

const EYE_HEIGHT = 1.66;
const CROUCH_EYE_HEIGHT = 1.02;
const STAND_RADIUS = 0.38;
const STAND_HALF_HEIGHT = 0.88;
const CROUCH_HALF_HEIGHT = 0.56;

const WALK_SPEED = 3.4;
const RUN_SPEED = 6.4;
const CROUCH_SPEED = 1.7;
const ACCELERATION = 34;
const AIR_ACCELERATION = 6;
const FRICTION = 12;
const GRAVITY = -19.5;
const JUMP_VELOCITY = 6.1;
const COYOTE_TIME = 0.12;

export type Stance = "stand" | "crouch";

/**
 * First-person character controller.
 *
 * Movement runs on Babylon's swept-ellipsoid collision rather than a rigid
 * body: for a game built around standing at exactly the right distance from a
 * wall, predictable non-penetrating motion beats physical accuracy. Havok still
 * owns the loose props, and the controller reports its position so those props
 * can be shoved out of the way.
 */
export class PlayerController {
  readonly camera: FreeCamera;
  readonly body: Mesh;

  private velocity = new Vector3(0, 0, 0);
  private verticalVelocity = 0;
  private grounded = false;
  private timeSinceGrounded = 0;
  private stance: Stance = "stand";
  private targetEyeHeight = EYE_HEIGHT;
  private currentEyeHeight = EYE_HEIGHT;

  private yaw = 0;
  private pitch = 0;

  private bobPhase = 0;
  private bobAmount = 0;

  stamina = 1;
  /** How loudly the player is currently moving, 0..1. NPCs read this. */
  noise = 0;
  /** True while the player is sprinting with stamina left. */
  sprinting = false;
  /** Movement is suspended entirely while a menu is up. */
  locked = false;
  /** Scales walk speed — paint mode drops it so you shuffle along the wall. */
  movementScale = 1;
  /** Jumping and sprinting are disabled while lining up a piece. */
  allowAthletics = true;

  constructor(
    private readonly scene: Scene,
    private readonly input: InputManager,
    private settings: GameSettings,
  ) {
    this.body = MeshBuilder.CreateBox("player.body", { size: 0.1 }, scene);
    this.body.isVisible = false;
    this.body.isPickable = false;
    this.body.checkCollisions = true;
    this.body.ellipsoid = new Vector3(STAND_RADIUS, STAND_HALF_HEIGHT, STAND_RADIUS);
    this.body.ellipsoidOffset = new Vector3(0, STAND_HALF_HEIGHT, 0);

    this.camera = new FreeCamera("camera.player", new Vector3(0, EYE_HEIGHT, 0), scene);
    this.camera.parent = this.body;
    this.camera.minZ = 0.08;
    this.camera.maxZ = 320;
    this.camera.fov = settings.fov;
    this.camera.inertia = 0;
    // We drive rotation by hand, so the camera's own input handlers stay off.
    this.camera.inputs.clear();

    scene.collisionsEnabled = true;
    scene.activeCamera = this.camera;
  }

  applySettings(settings: GameSettings): void {
    this.settings = settings;
    this.camera.fov = settings.fov;
  }

  get position(): Vector3 {
    return this.body.position;
  }

  get eyePosition(): Vector3 {
    return this.camera.globalPosition;
  }

  get forward(): Vector3 {
    return this.camera.getDirection(Vector3.Forward());
  }

  get isCrouching(): boolean {
    return this.stance === "crouch";
  }

  get isGrounded(): boolean {
    return this.grounded;
  }

  get speed(): number {
    return this.velocity.length();
  }

  teleport(position: Vector3, yaw = 0): void {
    this.body.position.copyFrom(position);
    this.body.computeWorldMatrix(true);
    this.velocity.setAll(0);
    this.verticalVelocity = 0;
    this.yaw = yaw;
    this.pitch = 0;
    this.camera.rotation.set(0, yaw, 0);
  }

  /** Mouse look. Kept separate so paint/photo modes can drive it themselves. */
  updateLook(deltaSeconds: number, sensitivityScale = 1): void {
    void deltaSeconds;
    const look = this.input.consumeLook();
    const sensitivity = 0.0022 * this.settings.mouseSensitivity * sensitivityScale;
    this.yaw += look.x * sensitivity;
    this.pitch += look.y * sensitivity * (this.settings.invertY ? -1 : 1);
    this.pitch = Scalar.Clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  update(deltaSeconds: number): void {
    const dt = Math.min(deltaSeconds, 0.05);

    this.updateStance(dt);

    const wantsMove = !this.locked;
    const forwardAxis = wantsMove ? this.input.axis("back", "forward") : 0;
    const strafeAxis = wantsMove ? this.input.axis("left", "right") : 0;

    // Sprinting needs stamina, forward intent and a standing stance.
    const wantsRun =
      wantsMove &&
      this.allowAthletics &&
      this.input.isDown("run") &&
      forwardAxis > 0 &&
      this.stance === "stand";
    this.sprinting = wantsRun && this.stama() > 0.02;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - dt * 0.28);
    } else {
      this.stamina = Math.min(1, this.stamina + dt * (this.speed < 0.5 ? 0.34 : 0.16));
    }

    const targetSpeed =
      (this.stance === "crouch" ? CROUCH_SPEED : this.sprinting ? RUN_SPEED : WALK_SPEED) *
      this.movementScale;

    // Build the desired horizontal velocity in world space.
    const forward = this.camera.getDirection(Vector3.Forward());
    forward.y = 0;
    if (forward.lengthSquared() > 1e-6) forward.normalize();
    const right = this.camera.getDirection(Vector3.Right());
    right.y = 0;
    if (right.lengthSquared() > 1e-6) right.normalize();

    const wish = forward.scale(forwardAxis).add(right.scale(strafeAxis));
    if (wish.lengthSquared() > 1) wish.normalize();

    const acceleration = this.grounded ? ACCELERATION : AIR_ACCELERATION;
    const desired = wish.scale(targetSpeed);
    this.velocity.x = approach(this.velocity.x, desired.x, acceleration * dt);
    this.velocity.z = approach(this.velocity.z, desired.z, acceleration * dt);

    if (wish.lengthSquared() < 1e-4 && this.grounded) {
      this.velocity.x = approach(this.velocity.x, 0, FRICTION * dt);
      this.velocity.z = approach(this.velocity.z, 0, FRICTION * dt);
    }

    // Jump, with a short grace window after leaving the ground.
    this.timeSinceGrounded = this.grounded ? 0 : this.timeSinceGrounded + dt;
    if (
      wantsMove &&
      this.allowAthletics &&
      this.input.wasPressed("jump") &&
      this.timeSinceGrounded < COYOTE_TIME &&
      this.stance === "stand"
    ) {
      this.verticalVelocity = JUMP_VELOCITY;
      this.grounded = false;
      this.timeSinceGrounded = COYOTE_TIME;
      this.noise = Math.max(this.noise, 0.7);
    }

    this.verticalVelocity += GRAVITY * dt;
    this.verticalVelocity = Math.max(this.verticalVelocity, -34);

    const before = this.body.position.clone();
    const displacement = new Vector3(
      this.velocity.x * dt,
      this.verticalVelocity * dt,
      this.velocity.z * dt,
    );
    this.body.moveWithCollisions(displacement);
    const after = this.body.position;

    // Grounded when the downward move was arrested by geometry.
    if (this.verticalVelocity <= 0) {
      const expectedDrop = displacement.y;
      const actualDrop = after.y - before.y;
      const wasGrounded = this.grounded;
      this.grounded = actualDrop > expectedDrop + 0.0008;
      if (this.grounded) {
        this.verticalVelocity = 0;
        if (!wasGrounded) this.noise = Math.max(this.noise, 0.55);
      }
    } else {
      this.grounded = false;
      // Bumped our head: kill the upward motion rather than sticking to it.
      if (after.y - before.y < displacement.y - 0.0008) this.verticalVelocity = 0;
    }

    // Horizontal velocity should reflect what actually happened, so running
    // into a wall does not keep the "sprinting" feel alive.
    const actualHorizontal = new Vector3(after.x - before.x, 0, after.z - before.z).scale(1 / Math.max(dt, 1e-5));
    this.velocity.x = actualHorizontal.x;
    this.velocity.z = actualHorizontal.z;

    this.updateNoise(dt);
    this.updateHeadBob(dt);
  }

  /** Ray from the eye, used by interaction, painting and NPC line-of-sight. */
  makeViewRay(length = 6): Ray {
    return new Ray(this.eyePosition, this.forward, length);
  }

  private stama(): number {
    return this.stamina;
  }

  private updateStance(dt: number): void {
    const wantsCrouch = !this.locked && this.input.isDown("crouch");
    if (wantsCrouch && this.stance === "stand") {
      this.setStance("crouch");
    } else if (!wantsCrouch && this.stance === "crouch" && this.hasHeadroom()) {
      this.setStance("stand");
    }

    this.currentEyeHeight = Scalar.Lerp(
      this.currentEyeHeight,
      this.targetEyeHeight,
      Math.min(1, dt * 12),
    );
  }

  private setStance(stance: Stance): void {
    this.stance = stance;
    const halfHeight = stance === "crouch" ? CROUCH_HALF_HEIGHT : STAND_HALF_HEIGHT;
    this.body.ellipsoid.set(STAND_RADIUS, halfHeight, STAND_RADIUS);
    this.body.ellipsoidOffset.set(0, halfHeight, 0);
    this.targetEyeHeight = stance === "crouch" ? CROUCH_EYE_HEIGHT : EYE_HEIGHT;
  }

  /** Refuses to stand up under a low ceiling. */
  private hasHeadroom(): boolean {
    const origin = this.body.position.add(new Vector3(0, CROUCH_HALF_HEIGHT, 0));
    const ray = new Ray(origin, Vector3.Up(), STAND_HALF_HEIGHT * 2 - CROUCH_HALF_HEIGHT + 0.1);
    const hit = this.scene.pickWithRay(ray, (mesh) => mesh.checkCollisions && mesh !== this.body);
    return !hit?.hit;
  }

  /**
   * Noise decays fast but spikes on sprinting, landing and kicking through
   * rubbish — it is what lets a pedestrian notice you without seeing you.
   */
  private updateNoise(dt: number): void {
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    let target = 0;
    if (this.grounded) {
      if (this.stance === "crouch") target = horizontalSpeed * 0.04;
      else if (this.sprinting) target = 0.55 + horizontalSpeed * 0.06;
      else target = horizontalSpeed * 0.075;
    }
    this.noise = Math.max(target, this.noise - dt * 1.6);
  }

  private updateHeadBob(dt: number): void {
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = this.grounded && horizontalSpeed > 0.4;
    this.bobAmount = Scalar.Lerp(this.bobAmount, moving ? 1 : 0, Math.min(1, dt * 8));
    if (moving) this.bobPhase += dt * (this.sprinting ? 13.5 : 8.4);

    const vertical = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmount;
    const lateral = Math.sin(this.bobPhase) * 0.022 * this.bobAmount;
    this.camera.position.set(lateral, this.currentEyeHeight + vertical, 0);
    this.camera.rotation.z = Math.sin(this.bobPhase) * 0.006 * this.bobAmount;
  }

  dispose(): void {
    this.body.dispose();
    this.camera.dispose();
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}
