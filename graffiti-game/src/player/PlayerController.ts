import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Ray } from "@babylonjs/core/Culling/ray";
import { Scalar } from "@babylonjs/core/Maths/math.scalar";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractMesh } from "@babylonjs/core/Meshes/abstractMesh";
import type { Scene } from "@babylonjs/core/scene";

import "@babylonjs/core/Collisions/collisionCoordinator";
import "@babylonjs/core/Culling/ray";

import { Actor } from "../npc/Actor";
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

/** Third-person framing. */
const CAMERA_DISTANCE = 5.2;
const SHOULDER_HEIGHT = 1.62;
const LOOK_AHEAD = 2.4;
/** Sideways offset so the writer sits off-centre instead of blocking the view. */
const SHOULDER_OFFSET = 0.62;

export type Stance = "stand" | "crouch";

/**
 * First/third-person character controller.
 *
 * The game is third-person while you are moving around — you can see your
 * writer, and the alley reads better over their shoulder — and snaps to first
 * person when you step up to a wall to paint. `V` toggles it manually outside
 * paint mode.
 *
 * Movement runs on Babylon's swept-ellipsoid collision rather than a rigid
 * body: for a game built around standing at exactly the right distance from a
 * wall, predictable non-penetrating motion beats physical accuracy. Havok still
 * owns the loose props.
 */
export class PlayerController {
  readonly camera: FreeCamera;
  readonly body: Mesh;
  /** The visible character. Hidden in first person. */
  readonly avatar: Actor;

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
  /** First person is forced while painting; otherwise the player chooses. */
  firstPerson = false;
  /** Raises the can arm on the avatar. */
  paintPose = false;
  /** World point the can hand should reach towards, or null for a neutral pose. */
  private paintTarget: Vector3 | null = null;
  /**
   * When set, the third-person camera frames this point instead of looking
   * straight ahead — used by guided painting to keep the player and the live
   * part of the artwork both on screen.
   */
  private framingFocus: Vector3 | null = null;
  private framedPosition: Vector3 | null = null;

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

    this.avatar = new Actor(
      scene,
      "player.avatar",
      { coat: "#2f3644", trousers: "#1c1f26", skin: "#d3a884", accent: "#c8203f", height: 1.8 },
      Vector3.Zero(),
    );

    this.camera = new FreeCamera("camera.player", new Vector3(0, EYE_HEIGHT, 0), scene);
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
    if (!this.wideView) this.camera.fov = settings.fov;
  }

  /** Paint mode widens the view so more of the wall is reachable. */
  private wideView = false;

  setWideView(wide: boolean, fov: number): void {
    this.wideView = wide;
    this.camera.fov = wide ? fov : this.settings.fov;
  }

  get position(): Vector3 {
    return this.body.position;
  }

  get eyePosition(): Vector3 {
    return this.body.position.add(new Vector3(0, this.currentEyeHeight, 0));
  }

  /** The direction the player is aiming, which is also the camera's forward. */
  get forward(): Vector3 {
    const cosPitch = Math.cos(this.pitch);
    return new Vector3(
      Math.sin(this.yaw) * cosPitch,
      -Math.sin(this.pitch),
      Math.cos(this.yaw) * cosPitch,
    ).normalize();
  }

  get aimYaw(): number {
    return this.yaw;
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
    this.avatar.root.position.copyFrom(position);
    this.velocity.setAll(0);
    this.verticalVelocity = 0;
    this.yaw = yaw;
    this.pitch = 0;
    this.updateCamera(1);
  }

  setPaintTarget(target: Vector3 | null): void {
    this.paintTarget = target;
  }

  setFramingFocus(focus: Vector3 | null): void {
    this.framingFocus = focus;
    if (!focus) this.framedPosition = null;
  }

  toggleViewMode(): boolean {
    this.firstPerson = !this.firstPerson;
    return this.firstPerson;
  }

  /** Mouse look. Paint mode does not call this — the mouse draws instead. */
  updateLook(deltaSeconds: number, sensitivityScale = 1): void {
    void deltaSeconds;
    const look = this.input.consumeLook();
    const sensitivity = 0.0022 * this.settings.mouseSensitivity * sensitivityScale;
    this.yaw += look.x * sensitivity;
    this.pitch += look.y * sensitivity * (this.settings.invertY ? -1 : 1);
    this.clampPitch();
  }

  /** Turns towards a yaw over time. Used when the game places the player. */
  faceTowards(targetYaw: number, deltaSeconds: number, rate = 5): void {
    let delta = targetYaw - this.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.yaw += delta * Math.min(1, deltaSeconds * rate);
  }

  /** Pitches towards a target, for framing an artwork vertically. */
  pitchTowards(targetPitch: number, deltaSeconds: number, rate = 5): void {
    this.pitch += (targetPitch - this.pitch) * Math.min(1, deltaSeconds * rate);
    this.clampPitch();
  }

  /** Keyboard aiming, used by paint mode where the mouse is the brush. */
  aimBy(yawDelta: number, pitchDelta: number): void {
    this.yaw += yawDelta;
    this.pitch += pitchDelta * (this.settings.invertY ? -1 : 1);
    this.clampPitch();
  }

  private clampPitch(): void {
    this.pitch = Scalar.Clamp(this.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
  }

  update(deltaSeconds: number): void {
    const dt = Math.min(deltaSeconds, 0.05);

    this.updateStance(dt);

    const wantsMove = !this.locked;
    const forwardAxis = wantsMove ? this.input.axis("back", "forward") : 0;
    const strafeAxis = wantsMove ? this.input.axis("left", "right") : 0;

    const wantsRun =
      wantsMove &&
      this.allowAthletics &&
      this.input.isDown("run") &&
      forwardAxis > 0 &&
      this.stance === "stand";
    this.sprinting = wantsRun && this.stamina > 0.02;
    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - dt * 0.28);
    } else {
      this.stamina = Math.min(1, this.stamina + dt * (this.speed < 0.5 ? 0.34 : 0.16));
    }

    const targetSpeed =
      (this.stance === "crouch" ? CROUCH_SPEED : this.sprinting ? RUN_SPEED : WALK_SPEED) *
      this.movementScale;

    this.applyMovement(dt, forwardAxis, strafeAxis, targetSpeed, wantsMove);
    this.updateNoise(dt);
    this.updateBob(dt);
    this.updateAvatar(dt);
    this.updateCamera(dt);
  }

  /**
   * Moves the player. Split out so paint mode can drive it with its own axes
   * (Shift + WASD) while WASD alone is aiming the camera.
   */
  applyMovementFromAxes(deltaSeconds: number, forwardAxis: number, strafeAxis: number, speed: number): void {
    const dt = Math.min(deltaSeconds, 0.05);
    this.updateStance(dt);
    this.applyMovement(dt, forwardAxis, strafeAxis, speed, true);
    this.updateNoise(dt);
    this.updateBob(dt);
    this.updateAvatar(dt);
    this.updateCamera(dt);
  }

  private applyMovement(
    dt: number,
    forwardAxis: number,
    strafeAxis: number,
    targetSpeed: number,
    wantsMove: boolean,
  ): void {
    const flatForward = new Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const wish = flatForward.scale(forwardAxis).add(right.scale(strafeAxis));
    if (wish.lengthSquared() > 1) wish.normalize();

    const acceleration = this.grounded ? ACCELERATION : AIR_ACCELERATION;
    const desired = wish.scale(targetSpeed);
    this.velocity.x = approach(this.velocity.x, desired.x, acceleration * dt);
    this.velocity.z = approach(this.velocity.z, desired.z, acceleration * dt);

    if (wish.lengthSquared() < 1e-4 && this.grounded) {
      this.velocity.x = approach(this.velocity.x, 0, FRICTION * dt);
      this.velocity.z = approach(this.velocity.z, 0, FRICTION * dt);
    }

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
      if (after.y - before.y < displacement.y - 0.0008) this.verticalVelocity = 0;
    }

    const actualHorizontal = new Vector3(after.x - before.x, 0, after.z - before.z).scale(
      1 / Math.max(dt, 1e-5),
    );
    this.velocity.x = actualHorizontal.x;
    this.velocity.z = actualHorizontal.z;
  }

  /** Ray from the eye, used by interaction, painting and NPC line-of-sight. */
  makeViewRay(length = 6): Ray {
    return new Ray(this.eyePosition, this.forward, length);
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

  private hasHeadroom(): boolean {
    const origin = this.body.position.add(new Vector3(0, CROUCH_HALF_HEIGHT, 0));
    const ray = new Ray(origin, Vector3.Up(), STAND_HALF_HEIGHT * 2 - CROUCH_HALF_HEIGHT + 0.1);
    const hit = this.scene.pickWithRay(ray, (mesh) => mesh.checkCollisions && mesh !== this.body);
    return !hit?.hit;
  }

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

  private updateBob(dt: number): void {
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const moving = this.grounded && horizontalSpeed > 0.4;
    this.bobAmount = Scalar.Lerp(this.bobAmount, moving ? 1 : 0, Math.min(1, dt * 8));
    if (moving) this.bobPhase += dt * (this.sprinting ? 13.5 : 8.4);
  }

  private updateAvatar(dt: number): void {
    this.avatar.root.position.copyFrom(this.body.position);
    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    // The writer faces where you are aiming, so strafing reads as sidestepping.
    this.avatar.setFacing(this.yaw, dt);
    this.avatar.animateLocomotion(dt, horizontalSpeed);
    // Only one of these may drive the can arm: the reach wins when guided
    // painting is feeding it a target, otherwise it falls back to the pose.
    if (this.paintTarget) this.avatar.reachTowards(this.paintTarget, dt);
    else this.avatar.setPaintPose(this.paintPose, dt);
    this.avatar.setVisible(!this.firstPerson);
  }

  /**
   * Places the camera. First person sits at the eye with a little head bob;
   * third person orbits behind and pulls in when geometry would clip it, which
   * matters constantly in an alley this tight.
   */
  private updateCamera(dt: number): void {
    const look = this.forward;
    const blend = Math.min(1, dt * 16);

    if (this.firstPerson) {
      const bobY = Math.sin(this.bobPhase * 2) * 0.035 * this.bobAmount;
      const bobX = Math.sin(this.bobPhase) * 0.022 * this.bobAmount;
      const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
      const target = this.body.position
        .add(new Vector3(0, this.currentEyeHeight + bobY, 0))
        .add(right.scale(bobX));
      this.camera.position = Vector3.Lerp(this.camera.position, target, blend);
      this.camera.rotation.z = Math.sin(this.bobPhase) * 0.006 * this.bobAmount;
      this.camera.setTarget(this.camera.position.add(look));
      return;
    }

    if (this.framingFocus) {
      this.updateFramingCamera(dt);
      return;
    }

    // Over-the-shoulder rather than straight behind the head: the writer sits
    // to one side and the alley ahead stays readable.
    const right = new Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const focus = this.body.position
      .add(new Vector3(0, SHOULDER_HEIGHT, 0))
      .add(right.scale(SHOULDER_OFFSET));
    const desired = focus.subtract(look.scale(CAMERA_DISTANCE));
    desired.y = Math.max(0.4, desired.y);
    const safe = this.resolveCameraCollision(focus, desired);
    this.camera.position = Vector3.Lerp(this.camera.position, safe, Math.min(1, dt * 12));
    this.camera.rotation.z = 0;
    this.camera.setTarget(focus.add(look.scale(LOOK_AHEAD)));
  }

  /**
   * Guided-painting camera.
   *
   * Sits off to the side of the line between the player and the part of the
   * artwork being painted, so both stay in frame, and pans smoothly as the
   * active section moves. Everything is lerped — no cuts, no snapping — and it
   * still runs through the same collision resolve so it cannot end up inside
   * the wall it is looking at.
   */
  private updateFramingCamera(dt: number): void {
    const focus = this.framingFocus;
    if (!focus) return;

    const player = this.body.position.add(new Vector3(0, SHOULDER_HEIGHT, 0));
    // Look from behind and to the side of the writer, angled at the work.
    const toWork = focus.subtract(player);
    toWork.y = 0;
    const distance = Math.max(1.2, toWork.length());
    if (toWork.lengthSquared() > 1e-5) toWork.normalize();
    const side = new Vector3(-toWork.z, 0, toWork.x);

    const desired = player
      .subtract(toWork.scale(distance * 0.85 + 2.6))
      .add(side.scale(1.9))
      .add(new Vector3(0, 1.15, 0));
    desired.y = Math.max(0.6, desired.y);

    const target = Vector3.Lerp(player, focus, 0.55);
    const safe = this.resolveCameraCollision(target, desired);

    // Slow lerp: the pan should read as deliberate camerawork, not a jerk.
    this.framedPosition = this.framedPosition
      ? Vector3.Lerp(this.framedPosition, safe, Math.min(1, dt * 3.2))
      : safe;
    this.camera.position = this.framedPosition.clone();
    this.camera.rotation.z = 0;
    this.camera.setTarget(target);
  }

  /** Pulls the third-person camera in front of anything it would clip through. */
  private resolveCameraCollision(focus: Vector3, desired: Vector3): Vector3 {
    const offset = desired.subtract(focus);
    const distance = offset.length();
    if (distance <= 0.01) return desired;
    const direction = offset.scale(1 / distance);
    const ray = new Ray(focus, direction, distance);
    const hit = this.scene.pickWithRay(
      ray,
      (mesh: AbstractMesh) =>
        mesh.isPickable && mesh.isVisible && mesh.checkCollisions && mesh !== this.body,
    );
    if (hit?.hit && typeof hit.distance === "number") {
      return focus.add(direction.scale(Math.max(0.35, hit.distance - 0.25)));
    }
    return desired;
  }

  dispose(): void {
    this.avatar.dispose();
    this.body.dispose();
    this.camera.dispose();
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  const delta = target - current;
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}
