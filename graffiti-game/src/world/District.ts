import { Color3 } from "@babylonjs/core/Maths/math.color";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PhysicsShapeType } from "@babylonjs/core/Physics/v2/IPhysicsEnginePlugin";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { Scene } from "@babylonjs/core/scene";

import type { SurfaceDef } from "../paint/PaintableSurface";
import type { PhysicsWorld } from "../core/Physics";
import { MaterialLibrary } from "./MaterialLibrary";
import { makeRandom, priorTagsTexture } from "./ProceduralTextures";
import {
  acUnit,
  alleyLamp,
  box,
  chainFence,
  cone,
  crateStack,
  cylinder,
  drainpipe,
  dumpster,
  fireEscape,
  loadingDock,
  neonSign,
  pallet,
  puddle,
  scatterClutter,
  van,
  wheelieBin,
  type PropContext,
} from "./Props";

export interface SupplyStash {
  id: string;
  position: Vector3;
  /** `cans` hands out a specific colour, `refill` tops the whole rack up. */
  kind: "cans" | "refill";
  colourId?: string;
  label: string;
}

export interface Hideout {
  position: Vector3;
  radius: number;
  label: string;
}

export interface DistrictData {
  surfaces: SurfaceDef[];
  playerSpawn: Vector3;
  playerSpawnYaw: number;
  pedestrianRoutes: Vector3[][];
  policeSpawns: Vector3[];
  stashes: SupplyStash[];
  hideouts: Hideout[];
  shadowCasters: Mesh[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

/** Facing helpers, in the plane-normal convention used by PaintableSurface. */
const FACE_SOUTH = 0; // normal points towards -Z
const FACE_NORTH = Math.PI; // normal points towards +Z
const FACE_EAST = -Math.PI / 2; // normal points towards +X
const FACE_WEST = Math.PI / 2; // normal points towards -X

/**
 * Builds the vertical slice: one back-alley district, roughly 120 m x 80 m.
 *
 * The geometry is intentionally hand-placed rather than procedurally generated —
 * a believable alley is about specific relationships (a dumpster you can climb,
 * a shutter lit by one bad lamp, a sightline from the street) and those do not
 * fall out of a noise function. Everything is built from the shared prop kit, so
 * a second district is a new layout file, not a new engine.
 */
export function buildDistrict(
  scene: Scene,
  materials: MaterialLibrary,
  physics: PhysicsWorld,
): DistrictData {
  const shadowCasters: Mesh[] = [];
  const ctx: PropContext = { scene, materials, physics, shadowCasters, rng: makeRandom(20260801) };

  const bounds = { minX: -58, maxX: 62, minZ: -40, maxZ: 40 };
  const surfaces: SurfaceDef[] = [];

  buildGround(ctx, bounds);
  buildNorthBlock(ctx);
  buildSouthBlock(ctx);
  buildEastStreet(ctx);
  buildWestDeadEnd(ctx);
  buildSideYard(ctx);
  buildOverpass(ctx);
  buildBoundary(ctx, bounds);

  // ---- paintable spots -----------------------------------------------------
  // Risk is the single number that ties a wall to the rest of the systems: it
  // scales fame, how often witnesses glance at you, and mission gating.

  surfaces.push(
    {
      id: "wall.tutorial",
      label: "Brick wall",
      position: new Vector3(-40, 2.2, 4.94),
      rotationY: FACE_SOUTH,
      width: 7,
      height: 3.6,
      risk: 0.26,
    },
    {
      id: "wall.dock",
      label: "Loading bay wall",
      position: new Vector3(-45, 2.0, -4.94),
      rotationY: FACE_NORTH,
      width: 6,
      height: 3.0,
      risk: 0.2,
    },
    {
      id: "wall.deadend",
      label: "Dead-end wall",
      position: new Vector3(-51.85, 2.3, 0),
      rotationY: FACE_EAST,
      width: 6.5,
      height: 3.6,
      risk: 0.3,
    },
    {
      id: "shutter.a",
      label: "Roller shutter",
      position: new Vector3(-26, 1.75, 4.86),
      rotationY: FACE_SOUTH,
      width: 4,
      height: 3.1,
      risk: 0.44,
    },
    {
      id: "shutter.b",
      label: "Workshop shutter",
      position: new Vector3(-13, 1.6, -4.86),
      rotationY: FACE_NORTH,
      width: 3.6,
      height: 2.8,
      risk: 0.4,
    },
    {
      id: "dumpster.flank",
      label: "Skip flank",
      position: new Vector3(-33, 0.72, 2.62),
      rotationY: FACE_SOUTH,
      width: 2.2,
      height: 1.0,
      risk: 0.18,
      texelsPerMetre: 260,
    },
    {
      id: "hoarding",
      label: "Site hoarding",
      position: new Vector3(2, 1.55, -4.82),
      rotationY: FACE_NORTH,
      width: 5,
      height: 2.5,
      risk: 0.52,
    },
    {
      id: "pillar.underpass",
      label: "Overpass pillar",
      position: new Vector3(15.1, 1.9, 0),
      rotationY: FACE_EAST,
      width: 2.4,
      height: 3.0,
      risk: 0.14,
    },
    {
      id: "yard.fireescape",
      label: "Fire-escape wall",
      position: new Vector3(-11, 5.1, 15.92),
      rotationY: FACE_SOUTH,
      width: 4,
      height: 2.4,
      risk: 0.78,
    },
    {
      id: "street.gable",
      label: "Street gable",
      position: new Vector3(51.85, 3.2, 6),
      rotationY: FACE_WEST,
      width: 7,
      height: 4.4,
      risk: 0.92,
    },
    {
      id: "street.shutter",
      label: "Shopfront shutter",
      position: new Vector3(51.85, 1.7, -8),
      rotationY: FACE_WEST,
      width: 4.5,
      height: 3.0,
      risk: 0.84,
    },
    {
      id: "van.flank",
      label: "Delivery van",
      position: new Vector3(43.42, 1.45, -2.5),
      rotationY: FACE_WEST,
      width: 3.6,
      height: 1.5,
      risk: 0.66,
      texelsPerMetre: 240,
    },
  );

  // ---- routes and points of interest ---------------------------------------

  const pedestrianRoutes: Vector3[][] = [
    // Street regulars — the busy loop, and the reason the gable is risky.
    [
      new Vector3(45.5, 0, -30),
      new Vector3(45.5, 0, -10),
      new Vector3(45.5, 0, 10),
      new Vector3(45.5, 0, 30),
      new Vector3(48.5, 0, 30),
      new Vector3(48.5, 0, 4),
      new Vector3(48.5, 0, -26),
    ],
    // Someone cutting through the alley on their way home.
    [
      new Vector3(40, 0, 1),
      new Vector3(20, 0, 1.5),
      new Vector3(0, 0, 0.5),
      new Vector3(-18, 0, 1),
      new Vector3(-30, 0, -1),
      new Vector3(-18, 0, -1.5),
      new Vector3(0, 0, -1),
      new Vector3(22, 0, -1),
      new Vector3(40, 0, -1),
    ],
    // Night-shift worker doing the rounds of the side yard.
    [
      new Vector3(-11, 0, 7),
      new Vector3(-7.5, 0, 12),
      new Vector3(-14, 0, 13),
      new Vector3(-11, 0, 8),
      new Vector3(-11, 0, 2),
      new Vector3(-24, 0, 2),
      new Vector3(-11, 0, 3),
    ],
  ];

  const policeSpawns = [
    new Vector3(46, 0, 34),
    new Vector3(46, 0, -34),
    new Vector3(38, 0, 0),
    new Vector3(-11, 0, 14),
  ];

  const stashes: SupplyStash[] = [
    {
      id: "stash.dock",
      position: new Vector3(-47.5, 1.35, -6.6),
      kind: "refill",
      label: "Paint stash",
    },
    {
      id: "stash.dumpster",
      position: new Vector3(-31.4, 0.35, 3.6),
      kind: "cans",
      colourId: "lime",
      label: "Stashed can",
    },
    {
      id: "stash.yard",
      position: new Vector3(-14.5, 0.35, 10.5),
      kind: "cans",
      colourId: "orange",
      label: "Stashed can",
    },
    {
      id: "stash.underpass",
      position: new Vector3(16.5, 0.35, 3.4),
      kind: "cans",
      colourId: "purple",
      label: "Stashed can",
    },
    {
      id: "stash.street",
      position: new Vector3(40.5, 0.35, 12),
      kind: "cans",
      colourId: "white",
      label: "Stashed can",
    },
  ];

  const hideouts: Hideout[] = [
    { position: new Vector3(16, 0, 0), radius: 7, label: "under the overpass" },
    { position: new Vector3(-49, 0, 0), radius: 7, label: "the dead end" },
    { position: new Vector3(-12, 0, 12), radius: 5.5, label: "the side yard" },
  ];

  return {
    surfaces,
    playerSpawn: new Vector3(-46, 1.7, 0),
    playerSpawnYaw: Math.PI / 2,
    pedestrianRoutes,
    policeSpawns,
    stashes,
    hideouts,
    shadowCasters,
    bounds,
  };
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildGround(ctx: PropContext, bounds: DistrictData["bounds"]): void {
  const width = bounds.maxX - bounds.minX;
  const depth = bounds.maxZ - bounds.minZ;
  const ground = MeshBuilder.CreateGround(
    "ground",
    { width, height: depth, subdivisions: 2 },
    ctx.scene,
  );
  ground.position.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2);
  ground.material = ctx.materials.get("asphalt");
  ground.checkCollisions = true;
  ground.receiveShadows = true;
  ctx.physics.addStatic(ground, PhysicsShapeType.BOX);

  // A shallow drainage channel down the middle of the alley.
  box(ctx, "alley.channel", { w: 88, h: 0.02, d: 0.36 }, new Vector3(-8, 0.011, 0), {
    material: ctx.materials.flat("#1b1b1f"),
    collide: false,
    pickable: false,
    receiveShadows: false,
  });

  // Kerb along the east street's footpath.
  box(ctx, "street.kerb", { w: 0.3, h: 0.16, d: 80 }, new Vector3(40, 0.08, 0), {
    material: ctx.materials.get("concrete"),
    pickable: false,
  });
  box(ctx, "street.footpath", { w: 4, h: 0.14, d: 80 }, new Vector3(37.9, 0.07, 0), {
    material: ctx.materials.get("concrete"),
    pickable: false,
  });

  // Damp patches. The alley never quite dries out.
  for (const [x, z, size] of [
    [-44, 1.5, 3.4],
    [-28, -2, 4.2],
    [-6, 1.8, 3.0],
    [12, -1.2, 5.0],
    [17, 2.4, 3.6],
    [30, 0.5, 4.4],
    [-13, 11, 3.2],
  ] as const) {
    puddle(ctx, `puddle.${x}.${z}`, new Vector3(x, 0, z), size);
  }
}

function buildNorthBlock(ctx: PropContext): void {
  const brick = ctx.materials.get("brickWarm");
  const brickCold = ctx.materials.get("brickCold");
  const concrete = ctx.materials.get("concrete");

  // Facade segments. The z offsets create setbacks so the wall is not one slab.
  const segments: Array<[x: number, width: number, height: number, z: number, mat: 0 | 1 | 2]> = [
    [-48, 14, 11, 17, 0],
    [-34, 14, 14, 18, 1],
    [-21, 12, 9.5, 16.6, 2],
    [-1, 12, 13, 17.4, 0],
    [10, 10, 10, 16.2, 1],
    [22, 14, 15.5, 18, 2],
    [32, 8, 12, 17, 0],
  ];

  for (const [x, width, height, z, mat] of segments) {
    const material = mat === 0 ? brick : mat === 1 ? brickCold : concrete;
    const depth = (z - 5) * 2;
    const mesh = box(ctx, `north.block.${x}`, { w: width, h: height, d: depth }, new Vector3(x, height / 2, z), {
      material,
      shadow: true,
    });
    ctx.physics.addStatic(mesh, PhysicsShapeType.BOX);
    // Parapet cap.
    box(ctx, `north.cap.${x}`, { w: width + 0.4, h: 0.5, d: depth + 0.4 }, new Vector3(x, height + 0.25, z), {
      material: ctx.materials.get("concreteDark"),
      collide: false,
      pickable: false,
    });
    // A band of windows, mostly dark.
    addWindows(ctx, `north.win.${x}`, x, width, height, 5.02, FACE_SOUTH);
  }

  // Grime layer over the tutorial wall so it reads as a wall people already hit.
  addPriorTags(ctx, "north.priorTags", new Vector3(-40, 2.4, 4.9), FACE_SOUTH, 9, 4);

  // Roller shutter behind the paintable panel at x = -26.
  addShutter(ctx, "north.shutter", new Vector3(-26, 1.75, 4.92), FACE_SOUTH, 4.4, 3.4, "shutter");

  // Street furniture and services.
  drainpipe(ctx, "north.pipe1", new Vector3(-30.5, 0, 4.86), 9);
  drainpipe(ctx, "north.pipe2", new Vector3(-2.5, 0, 4.86), 11);
  drainpipe(ctx, "north.pipe3", new Vector3(24, 0, 4.86), 12);
  acUnit(ctx, "north.ac1", new Vector3(-36, 3.4, 4.6), FACE_SOUTH);
  acUnit(ctx, "north.ac2", new Vector3(-18, 4.1, 4.6), FACE_SOUTH);
  acUnit(ctx, "north.ac3", new Vector3(8, 3.8, 4.6), FACE_SOUTH);

  dumpster(ctx, "north.dumpster", new Vector3(-33, 0, 3.6), 0, "#2f5d3f");
  crateStack(ctx, "north.crates", new Vector3(-22.5, 0, 3.9), 3);
  pallet(ctx, "north.pallet", new Vector3(-16, 0.55, 4.5), 0, 0.22);
  wheelieBin(ctx, "north.bin1", new Vector3(-8.4, 0.55, 3.9), "#2b4a7a");
  wheelieBin(ctx, "north.bin2", new Vector3(-7.5, 0.55, 4.4), "#3d6b2f");
  scatterClutter(ctx, "north.clutter", new Vector3(-30, 0, 3.4), 3, 7);
  scatterClutter(ctx, "north.clutter2", new Vector3(6, 0, 3.6), 3.5, 6);
}

function buildSouthBlock(ctx: PropContext): void {
  const brick = ctx.materials.get("brickCold");
  const concrete = ctx.materials.get("concreteDark");

  const segments: Array<[x: number, width: number, height: number, z: number, mat: 0 | 1]> = [
    [-50, 14, 12, -18, 0],
    [-38, 12, 9, -16.8, 1],
    [-24, 16, 13.5, -18, 0],
    [-6, 14, 10.5, -17, 1],
    [8, 12, 16, -18.5, 0],
    [22, 16, 11.5, -17.2, 1],
    [34, 8, 13, -18, 0],
  ];

  for (const [x, width, height, z, mat] of segments) {
    const material = mat === 0 ? brick : concrete;
    const depth = Math.abs(z + 5) * 2;
    const mesh = box(ctx, `south.block.${x}`, { w: width, h: height, d: depth }, new Vector3(x, height / 2, z), {
      material,
      shadow: true,
    });
    ctx.physics.addStatic(mesh, PhysicsShapeType.BOX);
    box(ctx, `south.cap.${x}`, { w: width + 0.4, h: 0.5, d: depth + 0.4 }, new Vector3(x, height + 0.25, z), {
      material: ctx.materials.get("concreteDark"),
      collide: false,
      pickable: false,
    });
    addWindows(ctx, `south.win.${x}`, x, width, height, -5.02, FACE_NORTH);
  }

  addShutter(ctx, "south.shutter", new Vector3(-13, 1.6, -4.92), FACE_NORTH, 4, 3.1, "shutterBlue");

  // Plywood hoarding around "works in progress".
  box(ctx, "south.hoarding", { w: 12, h: 2.7, d: 0.14 }, new Vector3(2, 1.35, -4.9), {
    material: ctx.materials.get("wood"),
    shadow: true,
  });
  for (let i = 0; i <= 6; i += 1) {
    box(ctx, `south.hoardingPost${i}`, { w: 0.14, h: 3, d: 0.14 }, new Vector3(-4 + i * 2, 1.5, -4.78), {
      material: ctx.materials.get("wood"),
      collide: false,
      pickable: false,
    });
  }

  drainpipe(ctx, "south.pipe1", new Vector3(-42, 0, -4.86), 8.5);
  drainpipe(ctx, "south.pipe2", new Vector3(-19, 0, -4.86), 13);
  drainpipe(ctx, "south.pipe3", new Vector3(14, 0, -4.86), 10);
  acUnit(ctx, "south.ac1", new Vector3(-30, 3.6, -4.6), FACE_NORTH);
  acUnit(ctx, "south.ac2", new Vector3(10, 4.4, -4.6), FACE_NORTH);

  dumpster(ctx, "south.dumpster", new Vector3(-20, 0, -3.7), Math.PI, "#5a3d2a");
  crateStack(ctx, "south.crates", new Vector3(-36.5, 0, -3.8), 2);
  pallet(ctx, "south.pallet", new Vector3(20, 0.55, -4.4), Math.PI, -0.24);
  wheelieBin(ctx, "south.bin", new Vector3(26, 0.55, -4.0), "#6b6b2f");
  cone(ctx, "south.cone1", new Vector3(-2, 0, -3.4));
  cone(ctx, "south.cone2", new Vector3(6.5, 0, -3.6));
  scatterClutter(ctx, "south.clutter", new Vector3(-18, 0, -3.4), 3.5, 8);

  // Lit sign over the workshop.
  neonSign(ctx, "south.sign", "24HR", "#35e0c4", new Vector3(-13, 4.4, -4.7), FACE_NORTH, 3);
  neonSign(ctx, "south.sign2", "BAR", "#ff3d7f", new Vector3(24, 4.0, -4.7), FACE_NORTH, 2.4);
}

function buildEastStreet(ctx: PropContext): void {
  const concrete = ctx.materials.get("concrete");
  const brick = ctx.materials.get("brickWarm");

  // The far side of the street, which frames the exposed gable.
  const segments: Array<[z: number, depth: number, height: number, mat: 0 | 1]> = [
    [24, 22, 14, 0],
    [4, 16, 17, 1],
    [-12, 14, 12, 0],
    [-30, 18, 15, 1],
  ];
  for (const [z, depth, height, mat] of segments) {
    const mesh = box(ctx, `east.block.${z}`, { w: 20, h: height, d: depth }, new Vector3(62, height / 2, z), {
      material: mat === 0 ? brick : concrete,
      shadow: true,
    });
    ctx.physics.addStatic(mesh, PhysicsShapeType.BOX);
    addWindows(ctx, `east.win.${z}`, z, depth, height, 51.98, FACE_WEST, true);
  }

  addShutter(ctx, "east.shutter", new Vector3(51.92, 1.7, -8), FACE_WEST, 5, 3.4, "shutter");
  addPriorTags(ctx, "east.priorTags", new Vector3(51.9, 3.4, 6), FACE_WEST, 8, 5);

  // Road markings.
  for (let z = -34; z < 36; z += 6) {
    box(ctx, `street.line.${z}`, { w: 0.16, h: 0.01, d: 3 }, new Vector3(46, 0.02, z), {
      material: ctx.materials.flat("#c9c07a"),
      collide: false,
      pickable: false,
    });
  }

  // Street lighting — tall, cold, and unforgiving.
  for (const z of [-24, -6, 12, 30]) {
    const pole = cylinder(ctx, `street.pole.${z}`, { diameter: 0.2, height: 7 }, new Vector3(39.2, 3.5, z), {
      material: ctx.materials.get("metalDark"),
      collide: true,
      shadow: true,
    });
    void pole;
    alleyLamp(
      ctx,
      `street.lamp.${z}`,
      new Vector3(39.2, 6.8, z),
      FACE_EAST,
      new Color3(0.95, 0.86, 0.62),
      1.5,
    );
  }

  van(ctx, "street.van", new Vector3(43.4, 0, -2.5), Math.PI / 2, "#d8d5cc");
  cone(ctx, "street.cone", new Vector3(41.6, 0, -6));
  cone(ctx, "street.cone2", new Vector3(41.6, 0, 1.4));
  wheelieBin(ctx, "street.bin", new Vector3(38.6, 0.62, 16), "#7a2f2f");
  neonSign(ctx, "east.sign", "LATE", "#f5d020", new Vector3(51.7, 5.6, -8), FACE_WEST, 3.4);
  scatterClutter(ctx, "street.clutter", new Vector3(38.5, 0, 20), 3, 5);
}

function buildWestDeadEnd(ctx: PropContext): void {
  const concrete = ctx.materials.get("concreteDark");

  const wall = box(ctx, "west.wall", { w: 8, h: 12, d: 12 }, new Vector3(-56, 6, 0), {
    material: concrete,
    shadow: true,
  });
  ctx.physics.addStatic(wall, PhysicsShapeType.BOX);

  loadingDock(ctx, "west.dock", new Vector3(-45, 0, -6.5), 9, 3, 1.1);
  chainFence(ctx, "west.fence", new Vector3(-51.8, 0, -5), new Vector3(-51.8, 0, -14));
  crateStack(ctx, "west.crates", new Vector3(-49, 1.1, -6.2), 2);
  pallet(ctx, "west.pallet1", new Vector3(-50.4, 0.55, 2.4), Math.PI / 2, 0.2);
  pallet(ctx, "west.pallet2", new Vector3(-50.4, 0.55, 3.2), Math.PI / 2, 0.26);
  dumpster(ctx, "west.dumpster", new Vector3(-48.5, 0, 3.4), Math.PI / 2, "#3a3f52");
  scatterClutter(ctx, "west.clutter", new Vector3(-48, 0, 0), 4, 9);

  // One failing lamp. This corner is meant to feel like the safe spot.
  const lamp = alleyLamp(
    ctx,
    "west.lamp",
    new Vector3(-51.6, 4.4, 1.5),
    FACE_EAST,
    new Color3(0.95, 0.62, 0.32),
    0.85,
  );
  // Slow flicker: a sine plus a stutter, so it never reads as a clean loop.
  let flickerTime = 0;
  ctx.scene.onBeforeRenderObservable.add(() => {
    flickerTime += ctx.scene.getEngine().getDeltaTime() / 1000;
    const wobble = 0.78 + Math.sin(flickerTime * 7.3) * 0.06 + Math.sin(flickerTime * 2.1) * 0.05;
    const stutter = Math.sin(flickerTime * 31) > 0.93 ? 0.35 : 1;
    lamp.light.intensity = wobble * stutter;
  });
}

function buildSideYard(ctx: PropContext): void {
  // The yard is the gap between the north segments at x in [-16, -6].
  const concrete = ctx.materials.get("concreteDark");

  // Back wall of the yard, carrying the fire-escape spot.
  const back = box(ctx, "yard.back", { w: 12, h: 13, d: 10 }, new Vector3(-11, 6.5, 21), {
    material: ctx.materials.get("brickCold"),
    shadow: true,
  });
  ctx.physics.addStatic(back, PhysicsShapeType.BOX);
  addWindows(ctx, "yard.win", -11, 12, 13, 15.98, FACE_SOUTH);

  // Side walls closing the yard in.
  box(ctx, "yard.left", { w: 1, h: 11, d: 11 }, new Vector3(-16.5, 5.5, 10.5), { material: concrete, shadow: true });
  box(ctx, "yard.right", { w: 1, h: 11, d: 11 }, new Vector3(-5.5, 5.5, 10.5), { material: concrete, shadow: true });

  const escape = fireEscape(ctx, "yard.escape", -11, 15.7, FACE_NORTH, 3.6);
  void escape;

  drainpipe(ctx, "yard.pipe", new Vector3(-15.4, 0, 15.6), 10);
  crateStack(ctx, "yard.crates", new Vector3(-15, 0, 10.2), 3);
  wheelieBin(ctx, "yard.bin", new Vector3(-6.6, 0.55, 12.4), "#4a4a52");
  scatterClutter(ctx, "yard.clutter", new Vector3(-11, 0, 11), 3.5, 7);
  puddle(ctx, "yard.puddle", new Vector3(-10, 0, 13.5), 3.6);

  alleyLamp(ctx, "yard.lamp", new Vector3(-6.2, 4.2, 9), FACE_WEST, new Color3(0.6, 0.75, 0.95), 0.7);
}

function buildOverpass(ctx: PropContext): void {
  const concrete = ctx.materials.get("concreteDark");

  // A road deck crossing the alley, giving us a genuinely dark, covered spot.
  const deck = box(ctx, "overpass.deck", { w: 9, h: 1.4, d: 26 }, new Vector3(16, 6.4, 0), {
    material: concrete,
    shadow: true,
  });
  ctx.physics.addStatic(deck, PhysicsShapeType.BOX);
  box(ctx, "overpass.parapetN", { w: 9.4, h: 1.1, d: 0.4 }, new Vector3(16, 7.6, 12.8), {
    material: concrete,
    pickable: false,
  });
  box(ctx, "overpass.parapetS", { w: 9.4, h: 1.1, d: 0.4 }, new Vector3(16, 7.6, -12.8), {
    material: concrete,
    pickable: false,
  });

  // Pillars. The east one carries a paintable panel.
  for (const z of [-3.2, 3.2]) {
    const pillar = box(ctx, `overpass.pillar.${z}`, { w: 2.6, h: 5.7, d: 2.6 }, new Vector3(16, 2.85, z), {
      material: concrete,
      shadow: true,
    });
    ctx.physics.addStatic(pillar, PhysicsShapeType.BOX);
  }
  addPriorTags(ctx, "overpass.priorTags", new Vector3(14.68, 2.4, -3.2), FACE_WEST, 2.4, 3.2);

  // Sodium lamp bolted to the underside — the only light in here.
  alleyLamp(ctx, "overpass.lamp", new Vector3(16, 5.5, 6.5), FACE_SOUTH, new Color3(0.98, 0.7, 0.36), 1.1);
  scatterClutter(ctx, "overpass.clutter", new Vector3(16, 0, 1), 4, 10);
  crateStack(ctx, "overpass.crates", new Vector3(17.6, 0, 4.2), 4);
}

/** Invisible walls plus a skyline silhouette, so the slice reads as a city. */
function buildBoundary(ctx: PropContext, bounds: DistrictData["bounds"]): void {
  const height = 26;
  const edges: Array<[Vector3, { w: number; h: number; d: number }]> = [
    [new Vector3(bounds.minX - 1, height / 2, 0), { w: 2, h: height, d: 90 }],
    [new Vector3(bounds.maxX + 1, height / 2, 0), { w: 2, h: height, d: 90 }],
    [new Vector3(0, height / 2, bounds.minZ - 1), { w: 130, h: height, d: 2 }],
    [new Vector3(0, height / 2, bounds.maxZ + 1), { w: 130, h: height, d: 2 }],
  ];
  for (const [position, size] of edges) {
    box(ctx, `bounds.${position.x}.${position.z}`, size, position, {
      visible: false,
      pickable: false,
    });
  }

  // Distant blocks beyond the playable area — pure silhouette, no collision.
  const rng = makeRandom(4242);
  const silhouette = ctx.materials.flat("#0d1018");
  for (let i = 0; i < 26; i += 1) {
    const onX = rng() > 0.5;
    const height2 = 18 + rng() * 34;
    const width = 10 + rng() * 20;
    const position = onX
      ? new Vector3(bounds.minX - 20 - rng() * 60, height2 / 2, -60 + rng() * 130)
      : new Vector3(-70 + rng() * 160, height2 / 2, (rng() > 0.5 ? 1 : -1) * (55 + rng() * 60));
    const mesh = box(ctx, `skyline.${i}`, { w: width, h: height2, d: width }, position, {
      material: silhouette,
      collide: false,
      pickable: false,
      receiveShadows: false,
    });
    mesh.isPickable = false;
    // A few lit windows in the distance keep the skyline from reading as a wall.
    if (rng() > 0.45) {
      neonSign(
        ctx,
        `skyline.sign.${i}`,
        ["OPEN", "HOTEL", "CAFE", "PARK"][Math.floor(rng() * 4)],
        ["#ff3d7f", "#35e0c4", "#f5d020", "#2a6df4"][Math.floor(rng() * 4)],
        new Vector3(position.x, height2 * 0.7, position.z + (position.z > 0 ? -width / 2 - 0.2 : width / 2 + 0.2)),
        position.z > 0 ? FACE_SOUTH : FACE_NORTH,
        6,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Detail helpers
// ---------------------------------------------------------------------------

/** A grid of window recesses, a few of them lit. */
function addWindows(
  ctx: PropContext,
  name: string,
  centre: number,
  span: number,
  height: number,
  facePosition: number,
  facing: number,
  alongZ = false,
): void {
  const rng = makeRandom(Math.round(centre * 977 + span * 13));
  const glass = ctx.materials.get("glassDark");
  const frame = ctx.materials.get("trim");
  const rows = Math.max(1, Math.floor((height - 5) / 3.2));
  const cols = Math.max(1, Math.floor(span / 2.6));

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const offset = (col - (cols - 1) / 2) * (span / cols);
      const y = 5.6 + row * 3.2;
      if (y > height - 1.4) continue;
      const position = alongZ
        ? new Vector3(facePosition, y, centre + offset)
        : new Vector3(centre + offset, y, facePosition);

      const lit = rng() > 0.74;
      const pane = box(ctx, `${name}.${row}.${col}`, { w: 1.3, h: 1.5, d: 0.08 }, position, {
        material: lit ? ctx.materials.flat(rng() > 0.5 ? "#ffcf8a" : "#8fb7ff", 0.75) : glass,
        collide: false,
        pickable: false,
        rotation: new Vector3(0, facing, 0),
      });
      pane.isPickable = false;

      box(
        ctx,
        `${name}.frame.${row}.${col}`,
        { w: 1.5, h: 1.7, d: 0.06 },
        position.add(alongZ ? new Vector3(0.02, 0, 0) : new Vector3(0, 0, facing === FACE_SOUTH ? -0.02 : 0.02)),
        { material: frame, collide: false, pickable: false, rotation: new Vector3(0, facing, 0) },
      );
    }
  }
}

/** Metal roller shutter panel set into a facade. */
function addShutter(
  ctx: PropContext,
  name: string,
  position: Vector3,
  facing: number,
  width: number,
  height: number,
  material: "shutter" | "shutterBlue",
): void {
  const plane = MeshBuilder.CreatePlane(name, { width, height }, ctx.scene);
  plane.position.copyFrom(position);
  plane.rotation.y = facing;
  plane.material = ctx.materials.get(material);
  plane.isPickable = false;
  plane.receiveShadows = true;

  // Housing box above the shutter.
  const housingOffset = facing === FACE_SOUTH ? -0.16 : facing === FACE_NORTH ? 0.16 : 0;
  const housingX = facing === FACE_WEST ? -0.16 : facing === FACE_EAST ? 0.16 : 0;
  box(
    ctx,
    `${name}.housing`,
    { w: width + 0.3, h: 0.4, d: 0.36 },
    new Vector3(position.x + housingX, position.y + height / 2 + 0.2, position.z + housingOffset),
    {
      material: ctx.materials.get("metalDark"),
      collide: false,
      pickable: false,
      rotation: new Vector3(0, facing, 0),
    },
  );
}

/** Faint layer of other writers' work, so no wall starts truly blank. */
function addPriorTags(
  ctx: PropContext,
  name: string,
  position: Vector3,
  facing: number,
  width: number,
  height: number,
): void {
  const plane = MeshBuilder.CreatePlane(name, { width, height }, ctx.scene);
  plane.position.copyFrom(position);
  plane.rotation.y = facing;
  const material = ctx.materials.flat("#ffffff");
  const cloned = material.clone(`${name}.mat`);
  const texture = priorTagsTexture(ctx.scene, Math.round(position.x * 31 + position.z));
  cloned.diffuseTexture = texture;
  cloned.useAlphaFromDiffuseTexture = true;
  cloned.diffuseColor = new Color3(1, 1, 1);
  cloned.emissiveColor = new Color3(0.02, 0.02, 0.02);
  plane.material = cloned;
  plane.isPickable = false;
  plane.receiveShadows = false;
}
