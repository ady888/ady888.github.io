# Alley Kings

An urban graffiti game built with **TypeScript + Babylon.js + Vite**. This repo
holds a deliberately scoped **vertical slice**: one detailed back-alley district,
roughly 120 m × 80 m, that exercises every system the full open-world concept
needs — movement, painting, witnesses, police, photography, supplies and
progression — without pretending to be a city yet.

Everything runs in the browser. No backend, no paid APIs, no downloaded assets:
every texture, sound and piece of geometry is generated at runtime.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production bundle into dist/
npm run preview  # serve the production build
```

---

## The game in one paragraph

You are a writer working a back alley at night. Find a surface, press <kbd>P</kbd>,
lay a piece down with a can that runs out of paint and pressure, then step back
and let it be scored. Fame from the piece is only half of it — a piece nobody
sees is worth little, so raise the camera with <kbd>F</kbd>, frame the wall, and
post the flick. Meanwhile the alley is populated: pedestrians on patrol routes
will notice you, and once one makes a call, officers arrive from the district
edges and sweep towards where you were last seen. Exposed walls pay far better
and are far more likely to get you nicked.

## Controls

| Key | Action |
| --- | --- |
| <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> | Move |
| <kbd>Shift</kbd> | Run (costs stamina, makes noise) |
| <kbd>Ctrl</kbd> | Crouch — quieter, and lets you paint low on a wall |
| <kbd>Space</kbd> | Jump |
| <kbd>E</kbd> | Interact / **hold** to finish a piece |
| <kbd>P</kbd> | Enter or leave paint mode at a surface |
| <kbd>F</kbd> | Raise / lower the camera |
| <kbd>G</kbd> | Open your flicks |
| <kbd>Esc</kbd> | Pause |

In paint mode:

| Key | Action |
| --- | --- |
| Hold **LMB** | Spray |
| <kbd>1</kbd>–<kbd>9</kbd> / wheel | Pick a can |
| <kbd>Q</kbd> | Cycle cap: skinny / standard / fat |
| <kbd>R</kbd> | Shake the can (restores pressure) |
| <kbd>Z</kbd> | Undo the last stroke |
| <kbd>B</kbd> | Lay a base coat over the wall |
| <kbd>T</kbd> | Stencil mode — <kbd>[</kbd> <kbd>]</kbd> to change, <kbd>,</kbd> <kbd>.</kbd> to rotate, wheel to resize |

---

## Architecture

```
src/
├─ main.ts                  boot: renderer → Game → render loop
├─ core/
│  ├─ EngineFactory.ts      WebGPU when usable, WebGL 2 otherwise (hard minimum)
│  ├─ Game.ts               the shell: owns the scene and the state machine
│  ├─ GameEvents.ts         GameState enum + every cross-system event payload
│  ├─ EventBus.ts           typed pub/sub — how systems talk without coupling
│  ├─ InputManager.ts       raw input → named actions, pointer lock, look deltas
│  ├─ Physics.ts            Havok integration (optional, degrades cleanly)
│  ├─ Persistence.ts        localStorage + IndexedDB wrappers
│  ├─ SaveSystem.ts         whole-game save schema
│  └─ Settings.ts           user settings, validated on read
├─ world/
│  ├─ ProceduralTextures.ts brick, concrete, asphalt, shutters, chain-link, signs
│  ├─ MaterialLibrary.ts    shared, cached materials
│  ├─ Props.ts              the prop kit: dumpsters, fire escapes, lamps, vans…
│  ├─ District.ts           the layout — this file *is* the level
│  ├─ Lighting.ts           night rig: moon, ambient, fog, glow
│  └─ Pickups.ts            paint stashes and their respawn timers
├─ player/PlayerController.ts   swept-ellipsoid FPS character
├─ paint/
│  ├─ PaintableSurface.ts   a wall: DynamicTexture + stroke ops + coverage grid
│  ├─ SurfaceManager.ts     registry, lookups, save/restore
│  ├─ PaintMode.ts          the painting loop: cursor, spray, stencils, caps
│  ├─ PaintScoring.ts       coverage / control / colour / risk → grade + fame
│  ├─ StrokeTypes.ts        the op format that makes saves tiny
│  ├─ Stencils.ts           vector stencil shapes
│  └─ Palette.ts            colours and cap profiles
├─ npc/
│  ├─ Actor.ts              shared blocky body, walk cycle, vision cone
│  ├─ Pedestrian.ts         witnesses: patrol → curious → alarmed → flee
│  ├─ Police.ts             officers: search → chase → grab → give up
│  ├─ HeatSystem.ts         wanted level, decay, "still searching" state
│  └─ NPCManager.ts         population, spawning, sirens
├─ photo/
│  ├─ PhotoMode.ts          viewfinder, framing score, screenshot capture
│  └─ Gallery.ts            IndexedDB-backed flick book
├─ progression/             profile + fame ladder, inventory, missions
├─ audio/SoundBank.ts       fully synthesised: spray hiss, sirens, footsteps
└─ ui/                      accessible HTML overlays (HUD, menus, gallery)
```

### Notable decisions

**Painting is stored as operations, not pixels.** Every dab, stroke, drip and
stencil is appended to a compact op list (`StrokeTypes.ts`) and replayed to
rebuild the canvas. A whole district of paintwork is a few kilobytes of JSON
instead of a megabyte of base64 PNG per wall, and undo, buffing and future
time-lapse replays fall out for free.

**Paint mode hands the mouse to a cursor, not to head-look.** On entering, the
camera settles square to the wall and the mouse drives a spray cursor that is
picked against the surface each frame. Fine linework is impossible with a fixed
reticle and free-look; you can still shuffle along the wall with WASD to reach
the far end of a big piece.

**The player is not a rigid body.** Movement runs on Babylon's swept-ellipsoid
collision, which is predictable and never penetrates — exactly what a game about
standing at the right distance from a wall needs. Havok owns the loose junk
(bins, bottles, cans, pallets) that scatters when you barge through it, and the
player shoves it with an impulse query. If the Havok WASM fails to load, the game
says so and carries on with static props.

**Risk is the number that ties the systems together.** Each surface carries an
exposure rating, and it drives the fame multiplier, how fast witnesses build
suspicion, mission gating, and photo value. The safest wall (under the overpass)
pays a fraction of the street-facing gable.

**Zero external assets.** Textures are drawn with 2D canvas ops and seeded noise;
audio is synthesised with Web Audio (the spray hiss is filtered white noise, the
siren is two oscillators). Nothing to license, nothing to download.

**The UI is HTML, not Babylon GUI.** Real focus handling, screen-reader
semantics, and CSS layout matter more here than drawing menus inside the canvas.

### Renderer support

`EngineFactory` prefers WebGPU when the browser genuinely supports it, falls back
to WebGL 2 on any initialisation failure, and refuses to run without WebGL 2
rather than limping along on WebGL 1. The choice can be forced from Settings.

### Persistence

- **localStorage** — profile, inventory, mission progress, and every surface's
  stroke history (`alleykings.save.v1`), plus settings.
- **IndexedDB** — photos, which are fat base64 JPEGs and would blow the
  localStorage quota. Capped at 40 shots, oldest evicted first.

Both layers degrade to in-memory no-ops if the browser blocks storage, so the
game still runs in private mode — it just will not remember anything.

---

## Development notes

In a dev build only (`npm run dev`), `window.alleyKings` exposes a handle for
driving the game from the console or an automated smoke test:

```js
alleyKings.state()                    // current game state
alleyKings.goToSurface('shutter.a')   // stand at a wall, facing it
alleyKings.testStroke('shutter.a')    // paint a stroke without input
alleyKings.heat(3)                    // set the wanted level
alleyKings.shoot()                    // take a photo
```

It is stripped from `npm run build`.

## Extending this into a city

The slice was built so that a second district is a **layout file, not an engine
change**:

- `District.ts` returns a `DistrictData` — surfaces, patrol routes, police spawn
  points, stashes and hideouts. Add `District2.ts` next to it and everything
  downstream (painting, heat, missions, photography) works unchanged.
- `Props.ts` is the shared kit. New neighbourhoods should mostly be new
  arrangements of it plus a handful of new prop builders.
- Streaming: surfaces already serialise independently by id, so districts can be
  loaded and unloaded without touching the save format.
- Missions are declarative (`Missions.ts`); new objectives are data.

## Publishing

The build uses a relative `base`, so `dist/` can be dropped into any folder of a
static host. Note that this folder lives inside a Jekyll site: `_config.yml`
excludes `graffiti-game` so the Jekyll build does not copy the TypeScript source
into the published site. To publish the game, build it and copy `dist/` to
wherever you want it served from.
