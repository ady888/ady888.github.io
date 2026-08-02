import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import type { MaterialLibrary } from "./MaterialLibrary";
import type { PhysicsWorld } from "../core/Physics";
import { makeRandom } from "./ProceduralTextures";

export interface PropContext {
  scene: Scene;
  materials: MaterialLibrary;
  physics: PhysicsWorld;
  /** Meshes that should cast shadows from the key light. */
  shadowCasters: Mesh[];
  rng: () => number;
}

export interface BoxOptions {
  material?: StandardMaterial;
  collide?: boolean;
  shadow?: boolean;
  rotation?: Vector3;
  parent?: TransformNode;
  visible?: boolean;
  receiveShadows?: boolean;
  pickable?: boolean;
}

/** Core primitive. Nearly everything in the district is one of these. */
export function box(
  ctx: PropContext,
  name: string,
  size: { w: number; h: number; d: number },
  position: Vector3,
  options: BoxOptions = {},
): Mesh {
  const mesh = MeshBuilder.CreateBox(
    name,
    { width: size.w, height: size.h, depth: size.d },
    ctx.scene,
  );
  mesh.position.copyFrom(position);
  if (options.rotation) mesh.rotation.copyFrom(options.rotation);
  if (options.material) mesh.material = options.material;
  if (options.parent) mesh.parent = options.parent;
  mesh.checkCollisions = options.collide ?? true;
  mesh.isPickable = options.pickable ?? true;
  mesh.receiveShadows = options.receiveShadows ?? true;
  if (options.visible === false) {
    mesh.isVisible = false;
    mesh.receiveShadows = false;
  }
  if (options.shadow && options.visible !== false) ctx.shadowCasters.push(mesh);
  return mesh;
}

export function cylinder(
  ctx: PropContext,
  name: string,
  options: {
    diameter: number;
    height: number;
    diameterTop?: number;
    tessellation?: number;
  },
  position: Vector3,
  props: BoxOptions = {},
): Mesh {
  const mesh = MeshBuilder.CreateCylinder(
    name,
    {
      diameter: options.diameter,
      diameterTop: options.diameterTop ?? options.diameter,
      height: options.height,
      tessellation: options.tessellation ?? 12,
    },
    ctx.scene,
  );
  mesh.position.copyFrom(position);
  if (props.rotation) mesh.rotation.copyFrom(props.rotation);
  if (props.material) mesh.material = props.material;
  if (props.parent) mesh.parent = props.parent;
  mesh.checkCollisions = props.collide ?? false;
  mesh.isPickable = props.pickable ?? true;
  mesh.receiveShadows = props.receiveShadows ?? true;
  if (props.shadow) ctx.shadowCasters.push(mesh);
  return mesh;
}

/**
 * A commercial skip bin. The long flat side is a classic spot, so the caller
 * usually attaches a paintable surface to it.
 */
export function dumpster(ctx: PropContext, name: string, position: Vector3, yaw: number, tint: string): TransformNode {
  const root = new TransformNode(name, ctx.scene);
  root.position.copyFrom(position);
  root.rotation.y = yaw;

  const body = ctx.materials.flat(tint);
  const dark = ctx.materials.get("metalDark");

  box(ctx, `${name}.body`, { w: 2.3, h: 1.15, d: 1.25 }, new Vector3(0, 0.66, 0), {
    material: body,
    parent: root,
    shadow: true,
  });
  // Tapered top edge so it does not read as a plain crate.
  box(ctx, `${name}.rim`, { w: 2.4, h: 0.1, d: 1.35 }, new Vector3(0, 1.26, 0), {
    material: dark,
    parent: root,
    collide: false,
  });
  // Lids, one flipped open.
  box(ctx, `${name}.lidA`, { w: 1.12, h: 0.07, d: 1.3 }, new Vector3(-0.58, 1.32, 0), {
    material: dark,
    parent: root,
    collide: false,
  });
  box(ctx, `${name}.lidB`, { w: 1.12, h: 0.07, d: 1.3 }, new Vector3(0.62, 1.62, -0.5), {
    material: dark,
    parent: root,
    collide: false,
    rotation: new Vector3(-0.9, 0, 0),
  });
  for (const [x, z] of [
    [-0.9, 0.5],
    [0.9, 0.5],
    [-0.9, -0.5],
    [0.9, -0.5],
  ] as const) {
    cylinder(
      ctx,
      `${name}.wheel${x}${z}`,
      { diameter: 0.22, height: 0.1, tessellation: 8 },
      new Vector3(x, 0.11, z),
      { material: dark, parent: root, rotation: new Vector3(0, 0, Math.PI / 2) },
    );
  }
  // Overflowing rubbish.
  const bagMat = ctx.materials.flat("#1a1a1e");
  for (let i = 0; i < 4; i += 1) {
    const sphere = MeshBuilder.CreateSphere(
      `${name}.bag${i}`,
      { diameter: 0.3 + ctx.rng() * 0.25, segments: 6 },
      ctx.scene,
    );
    sphere.parent = root;
    sphere.position.set(-0.6 + ctx.rng() * 1.2, 1.3 + ctx.rng() * 0.12, -0.3 + ctx.rng() * 0.6);
    sphere.scaling.y = 0.75;
    sphere.material = bagMat;
    sphere.isPickable = false;
    ctx.shadowCasters.push(sphere);
  }
  return root;
}

/** Two-wheel domestic bin. Light enough for Havok to send it rolling. */
export function wheelieBin(ctx: PropContext, name: string, position: Vector3, tint: string): Mesh {
  const bin = box(ctx, name, { w: 0.62, h: 1.05, d: 0.72 }, position, {
    material: ctx.materials.flat(tint),
    shadow: true,
    collide: false,
  });
  ctx.physics.addDynamic(bin, 14, PhysicsShapeType.BOX, { friction: 0.6, restitution: 0.1 });
  // Without Havok the bin still needs to be solid, so fall back to collisions.
  if (!ctx.physics.enabled) bin.checkCollisions = true;
  return bin;
}

/** Wooden pallet leaning against a wall. */
export function pallet(ctx: PropContext, name: string, position: Vector3, yaw: number, lean: number): TransformNode {
  const root = new TransformNode(name, ctx.scene);
  root.position.copyFrom(position);
  root.rotation.set(lean, yaw, 0);
  const wood = ctx.materials.get("wood");
  for (let i = 0; i < 6; i += 1) {
    box(ctx, `${name}.slat${i}`, { w: 1.2, h: 0.04, d: 0.11 }, new Vector3(0, i * 0.19 - 0.5, 0.06), {
      material: wood,
      parent: root,
      collide: false,
      shadow: true,
    });
  }
  for (const x of [-0.5, 0, 0.5]) {
    box(ctx, `${name}.rail${x}`, { w: 0.08, h: 1.15, d: 0.08 }, new Vector3(x, 0, 0), {
      material: wood,
      parent: root,
      collide: false,
    });
  }
  return root;
}

/** Stack of milk crates — the classic improvised step-up. */
export function crateStack(ctx: PropContext, name: string, position: Vector3, count: number): TransformNode {
  const root = new TransformNode(name, ctx.scene);
  root.position.copyFrom(position);
  const colours = ["#1f4d8f", "#8f2f2f", "#2f7d4a"];
  for (let i = 0; i < count; i += 1) {
    box(
      ctx,
      `${name}.crate${i}`,
      { w: 0.42, h: 0.3, d: 0.42 },
      new Vector3((ctx.rng() - 0.5) * 0.08, 0.15 + i * 0.3, (ctx.rng() - 0.5) * 0.08),
      {
        material: ctx.materials.flat(colours[i % colours.length]),
        parent: root,
        shadow: true,
        rotation: new Vector3(0, (ctx.rng() - 0.5) * 0.5, 0),
      },
    );
  }
  return root;
}

/** Wall-mounted air-conditioning condenser with a fan face. */
export function acUnit(ctx: PropContext, name: string, position: Vector3, yaw: number): TransformNode {
  const root = new TransformNode(name, ctx.scene);
  root.position.copyFrom(position);
  root.rotation.y = yaw;
  const metal = ctx.materials.get("metal");
  box(ctx, `${name}.body`, { w: 1.05, h: 0.8, d: 0.5 }, Vector3.Zero(), {
    material: metal,
    parent: root,
    shadow: true,
    collide: false,
  });
  const grille = MeshBuilder.CreateDisc(`${name}.fan`, { radius: 0.28, tessellation: 16 }, ctx.scene);
  grille.parent = root;
  grille.position.set(0, 0, -0.26);
  grille.rotation.y = Math.PI;
  grille.material = ctx.materials.get("metalDark");
  grille.isPickable = false;
  // Support brackets.
  for (const x of [-0.45, 0.45]) {
    box(ctx, `${name}.bracket${x}`, { w: 0.05, h: 0.05, d: 0.55 }, new Vector3(x, -0.42, 0.05), {
      material: ctx.materials.get("metalDark"),
      parent: root,
      collide: false,
    });
  }
  return root;
}

/** Vertical drainpipe with brackets. */
export function drainpipe(ctx: PropContext, name: string, position: Vector3, height: number): TransformNode {
  const root = new TransformNode(name, ctx.scene);
  root.position.copyFrom(position);
  const metal = ctx.materials.get("metalDark");
  cylinder(ctx, `${name}.pipe`, { diameter: 0.14, height }, new Vector3(0, height / 2, 0), {
    material: metal,
    parent: root,
    shadow: true,
  });
  for (let y = 1.2; y < height; y += 2.4) {
    box(ctx, `${name}.clamp${y}`, { w: 0.2, h: 0.06, d: 0.2 }, new Vector3(0, y, 0), {
      material: metal,
      parent: root,
      collide: false,
    });
  }
  // Shoe at the bottom kicking the water out.
  cylinder(ctx, `${name}.shoe`, { diameter: 0.16, height: 0.4 }, new Vector3(0, 0.18, -0.14), {
    material: metal,
    parent: root,
    rotation: new Vector3(0.5, 0, 0),
  });
  return root;
}

export interface LampResult {
  root: TransformNode;
  light: PointLight;
}

/** Sodium-vapour alley lamp on a wall bracket. */
export function alleyLamp(
  ctx: PropContext,
  name: string,
  position: Vector3,
  yaw: number,
  colour: Color3,
  intensity = 0.9,
): LampResult {
  const root = new TransformNode(name, ctx.scene);
  root.position.copyFrom(position);
  root.rotation.y = yaw;
  const metal = ctx.materials.get("metalDark");

  box(ctx, `${name}.arm`, { w: 0.07, h: 0.07, d: 0.9 }, new Vector3(0, 0, -0.45), {
    material: metal,
    parent: root,
    collide: false,
  });
  box(ctx, `${name}.hood`, { w: 0.5, h: 0.12, d: 0.42 }, new Vector3(0, -0.06, -0.85), {
    material: metal,
    parent: root,
    collide: false,
  });

  const bulbMaterial = new StandardMaterial(`${name}.bulbMat`, ctx.scene);
  bulbMaterial.emissiveColor = colour;
  bulbMaterial.diffuseColor = colour.scale(0.4);
  bulbMaterial.disableLighting = true;
  const bulb = MeshBuilder.CreateBox(`${name}.bulb`, { width: 0.4, height: 0.05, depth: 0.33 }, ctx.scene);
  bulb.parent = root;
  bulb.position.set(0, -0.14, -0.85);
  bulb.material = bulbMaterial;
  bulb.isPickable = false;

  const light = new PointLight(`${name}.light`, Vector3.Zero(), ctx.scene);
  light.parent = root;
  light.position.set(0, -0.3, -0.85);
  light.diffuse = colour;
  light.specular = colour.scale(0.5);
  light.intensity = intensity;
  light.range = 16;

  return { root, light };
}

/** Illuminated shop sign. Emissive, and picked up by the glow layer. */
export function neonSign(
  ctx: PropContext,
  name: string,
  text: string,
  ink: string,
  position: Vector3,
  yaw: number,
  width = 2.6,
): Mesh {
  const sign = MeshBuilder.CreatePlane(name, { width, height: width / 2 }, ctx.scene);
  sign.position.copyFrom(position);
  sign.rotation.y = yaw;
  sign.material = ctx.materials.sign(text, ink);
  sign.isPickable = false;

  const light = new PointLight(`${name}.glow`, position.clone(), ctx.scene);
  light.diffuse = Color3.FromHexString(ink);
  light.intensity = 0.5;
  light.range = 9;
  return sign;
}

/** Chain-link fence run, with posts and a top rail. */
export function chainFence(
  ctx: PropContext,
  name: string,
  from: Vector3,
  to: Vector3,
  height = 2.6,
): TransformNode {
  const root = new TransformNode(name, ctx.scene);
  const direction = to.subtract(from);
  const length = direction.length();
  const centre = from.add(direction.scale(0.5));
  const yaw = Math.atan2(direction.x, direction.z);

  const mesh = MeshBuilder.CreatePlane(`${name}.mesh`, { width: length, height }, ctx.scene);
  mesh.position.set(centre.x, height / 2, centre.z);
  mesh.rotation.y = yaw + Math.PI / 2;
  mesh.material = ctx.materials.get("chainLink");
  mesh.isPickable = false;
  mesh.parent = root;

  // Invisible slab does the colliding; the alpha-tested mesh is visual only.
  const blocker = box(
    ctx,
    `${name}.blocker`,
    { w: length, h: height, d: 0.12 },
    new Vector3(centre.x, height / 2, centre.z),
    { visible: false, rotation: new Vector3(0, yaw + Math.PI / 2, 0), pickable: false },
  );
  blocker.parent = root;

  const metal = ctx.materials.get("metal");
  const postCount = Math.max(2, Math.round(length / 3));
  for (let i = 0; i <= postCount; i += 1) {
    const t = i / postCount;
    const position = Vector3.Lerp(from, to, t);
    cylinder(ctx, `${name}.post${i}`, { diameter: 0.09, height: height + 0.16 }, new Vector3(position.x, (height + 0.16) / 2, position.z), {
      material: metal,
      parent: root,
      shadow: true,
    });
  }
  cylinder(ctx, `${name}.rail`, { diameter: 0.07, height: length }, new Vector3(centre.x, height, centre.z), {
    material: metal,
    parent: root,
    rotation: new Vector3(Math.PI / 2, yaw, 0),
  });
  return root;
}

/** Flat wet patch on the ground. Purely decorative, never collides. */
export function puddle(ctx: PropContext, name: string, position: Vector3, size: number): Mesh {
  const disc = MeshBuilder.CreateGround(name, { width: size, height: size * 0.7 }, ctx.scene);
  disc.position.set(position.x, 0.012, position.z);
  disc.rotation.y = ctx.rng() * Math.PI;
  disc.material = ctx.materials.get("puddle");
  disc.isPickable = false;
  disc.checkCollisions = false;
  return disc;
}

/** Small loose junk that Havok can scatter. */
export function litter(ctx: PropContext, name: string, position: Vector3, kind: "can" | "bottle" | "box"): Mesh {
  let mesh: Mesh;
  if (kind === "can") {
    mesh = MeshBuilder.CreateCylinder(name, { diameter: 0.07, height: 0.14, tessellation: 8 }, ctx.scene);
    mesh.material = ctx.materials.flat("#b9bec6");
    mesh.rotation.z = Math.PI / 2;
  } else if (kind === "bottle") {
    mesh = MeshBuilder.CreateCylinder(name, { diameter: 0.08, diameterTop: 0.035, height: 0.25, tessellation: 8 }, ctx.scene);
    mesh.material = ctx.materials.flat("#2e5c3a");
  } else {
    mesh = MeshBuilder.CreateBox(name, { width: 0.4, height: 0.28, depth: 0.3 }, ctx.scene);
    mesh.material = ctx.materials.get("wood");
  }
  mesh.position.copyFrom(position);
  mesh.isPickable = false;
  ctx.shadowCasters.push(mesh);
  ctx.physics.addDynamic(mesh, kind === "box" ? 1.2 : 0.25, PhysicsShapeType.BOX, {
    restitution: 0.35,
    friction: 0.45,
  });
  return mesh;
}

/** Traffic cone. */
export function cone(ctx: PropContext, name: string, position: Vector3): TransformNode {
  const root = new TransformNode(name, ctx.scene);
  root.position.copyFrom(position);
  cylinder(ctx, `${name}.body`, { diameter: 0.34, diameterTop: 0.05, height: 0.6 }, new Vector3(0, 0.3, 0), {
    material: ctx.materials.flat("#e2521c", 0.12),
    parent: root,
    shadow: true,
  });
  box(ctx, `${name}.base`, { w: 0.38, h: 0.04, d: 0.38 }, new Vector3(0, 0.02, 0), {
    material: ctx.materials.flat("#e2521c", 0.12),
    parent: root,
    collide: false,
  });
  return root;
}

export interface FireEscapeResult {
  root: TransformNode;
  /** Centre of the upper platform — where a paintable wall can be reached. */
  platformCentre: Vector3;
}

/**
 * Fire escape: a landing you can actually stand on, reached by a staircase.
 *
 * The visible steps are decoration; an invisible ramp underneath does the
 * colliding, which makes the climb smooth for a swept-ellipsoid character
 * instead of catching on every riser.
 */
export function fireEscape(
  ctx: PropContext,
  name: string,
  wallX: number,
  wallZ: number,
  facing: number,
  platformY = 3.6,
): FireEscapeResult {
  const root = new TransformNode(name, ctx.scene);
  root.position.set(wallX, 0, wallZ);
  root.rotation.y = facing;

  const metal = ctx.materials.get("metal");
  const dark = ctx.materials.get("metalDark");

  // Landing.
  const platformDepth = 1.7;
  const platformWidth = 4.2;
  box(ctx, `${name}.platform`, { w: platformWidth, h: 0.12, d: platformDepth }, new Vector3(0, platformY, -platformDepth / 2), {
    material: metal,
    parent: root,
    shadow: true,
  });
  // Railings.
  for (const [x, w, d, px, pz] of [
    [0, platformWidth, 0.06, 0, -platformDepth],
    [-platformWidth / 2, 0.06, platformDepth, -platformWidth / 2, -platformDepth / 2],
    [platformWidth / 2, 0.06, platformDepth, platformWidth / 2, -platformDepth / 2],
  ] as const) {
    void x;
    box(ctx, `${name}.rail${px}${pz}`, { w, h: 1, d }, new Vector3(px, platformY + 0.56, pz), {
      material: dark,
      parent: root,
      collide: true,
      shadow: true,
    });
  }

  // Staircase: visual treads plus a hidden ramp collider.
  const runLength = 4.6;
  const steps = 14;
  for (let i = 0; i < steps; i += 1) {
    const t = (i + 0.5) / steps;
    box(
      ctx,
      `${name}.step${i}`,
      { w: 1.1, h: 0.05, d: runLength / steps },
      new Vector3(platformWidth / 2 - 0.55, platformY * t, -platformDepth - runLength * (1 - t) + runLength / (steps * 2)),
      { material: metal, parent: root, collide: false, shadow: i % 3 === 0 },
    );
  }
  const rampAngle = Math.atan2(platformY, runLength);
  const ramp = box(
    ctx,
    `${name}.ramp`,
    { w: 1.15, h: 0.2, d: Math.hypot(platformY, runLength) + 0.4 },
    new Vector3(platformWidth / 2 - 0.55, platformY / 2 - 0.06, -platformDepth - runLength / 2),
    { visible: false, parent: root, rotation: new Vector3(-rampAngle, 0, 0), pickable: false },
  );
  ramp.checkCollisions = true;

  // Stringer + handrail so the stair reads as built, not floating.
  box(ctx, `${name}.stringer`, { w: 0.08, h: 0.2, d: Math.hypot(platformY, runLength) }, new Vector3(platformWidth / 2 - 1.12, platformY / 2 - 0.14, -platformDepth - runLength / 2), {
    material: dark,
    parent: root,
    collide: false,
    rotation: new Vector3(-rampAngle, 0, 0),
  });
  box(ctx, `${name}.handrail`, { w: 0.06, h: 0.06, d: Math.hypot(platformY, runLength) }, new Vector3(platformWidth / 2 - 1.12, platformY / 2 + 0.86, -platformDepth - runLength / 2), {
    material: dark,
    parent: root,
    collide: false,
    rotation: new Vector3(-rampAngle, 0, 0),
  });

  // Support posts under the landing.
  for (const x of [-platformWidth / 2 + 0.2, platformWidth / 2 - 0.2]) {
    cylinder(ctx, `${name}.post${x}`, { diameter: 0.1, height: platformY }, new Vector3(x, platformY / 2, -platformDepth + 0.2), {
      material: dark,
      parent: root,
      shadow: true,
    });
  }

  const platformCentre = Vector3.TransformCoordinates(
    new Vector3(0, platformY + 0.1, -platformDepth / 2),
    root.getWorldMatrix(),
  );
  return { root, platformCentre };
}

/** A parked delivery van. The side panel is a paintable surface. */
export function van(ctx: PropContext, name: string, position: Vector3, yaw: number, tint: string): TransformNode {
  const root = new TransformNode(name, ctx.scene);
  root.position.copyFrom(position);
  root.rotation.y = yaw;
  const body = ctx.materials.flat(tint);
  const glass = ctx.materials.get("glassDark");
  const dark = ctx.materials.get("metalDark");

  box(ctx, `${name}.box`, { w: 2.1, h: 1.7, d: 4.0 }, new Vector3(0, 1.35, -0.5), {
    material: body,
    parent: root,
    shadow: true,
  });
  box(ctx, `${name}.cab`, { w: 2.0, h: 1.1, d: 1.7 }, new Vector3(0, 1.05, 2.35), {
    material: body,
    parent: root,
    shadow: true,
  });
  box(ctx, `${name}.windscreen`, { w: 1.86, h: 0.62, d: 0.1 }, new Vector3(0, 1.34, 3.14), {
    material: glass,
    parent: root,
    collide: false,
    rotation: new Vector3(-0.22, 0, 0),
  });
  for (const side of [-1, 1]) {
    box(ctx, `${name}.sidewin${side}`, { w: 0.08, h: 0.5, d: 0.9 }, new Vector3(side * 1.0, 1.3, 2.4), {
      material: glass,
      parent: root,
      collide: false,
    });
  }
  for (const [x, z] of [
    [-0.95, 2.0],
    [0.95, 2.0],
    [-0.95, -1.6],
    [0.95, -1.6],
  ] as const) {
    cylinder(ctx, `${name}.wheel${x}${z}`, { diameter: 0.72, height: 0.28, tessellation: 14 }, new Vector3(x, 0.36, z), {
      material: dark,
      parent: root,
      rotation: new Vector3(0, 0, Math.PI / 2),
      collide: false,
    });
  }
  return root;
}

/** Raised loading dock with a lip and a set of steps. */
export function loadingDock(ctx: PropContext, name: string, position: Vector3, width: number, depth: number, height = 1.1): TransformNode {
  const root = new TransformNode(name, ctx.scene);
  root.position.copyFrom(position);
  const concrete = ctx.materials.get("concreteDark");

  box(ctx, `${name}.slab`, { w: width, h: height, d: depth }, new Vector3(0, height / 2, 0), {
    material: concrete,
    parent: root,
    shadow: true,
  });
  box(ctx, `${name}.lip`, { w: width, h: 0.12, d: 0.16 }, new Vector3(0, height, -depth / 2), {
    material: ctx.materials.flat("#c8b83c"),
    parent: root,
    collide: false,
  });
  // Ramp at one end instead of steps, so the climb is smooth.
  const rampLength = 2.2;
  const angle = Math.atan2(height, rampLength);
  box(
    ctx,
    `${name}.ramp`,
    { w: 1.8, h: 0.16, d: Math.hypot(height, rampLength) + 0.2 },
    new Vector3(width / 2 + 0.9, height / 2 - 0.05, -depth / 2 - rampLength / 2 + 0.4),
    { material: concrete, parent: root, rotation: new Vector3(-angle, 0, 0), shadow: true },
  );
  return root;
}

/** Scatters small clutter around a point so corners never look swept. */
export function scatterClutter(ctx: PropContext, name: string, centre: Vector3, radius: number, count: number): void {
  const rng = makeRandom(Math.round(centre.x * 71 + centre.z * 131) + 9001);
  const kinds: Array<"can" | "bottle" | "box"> = ["can", "bottle", "can", "box"];
  for (let i = 0; i < count; i += 1) {
    const angle = rng() * Math.PI * 2;
    const distance = Math.sqrt(rng()) * radius;
    litter(
      ctx,
      `${name}.${i}`,
      new Vector3(centre.x + Math.cos(angle) * distance, 0.16 + rng() * 0.1, centre.z + Math.sin(angle) * distance),
      kinds[Math.floor(rng() * kinds.length)],
    );
  }
}
