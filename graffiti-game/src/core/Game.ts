import { Scene } from "@babylonjs/core/scene";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

import { EventBus } from "./EventBus";
import { GameState, type GameEventMap } from "./GameEvents";
import { InputManager } from "./InputManager";
import { PhysicsWorld } from "./Physics";
import { SaveSystem } from "./SaveSystem";
import { loadSettings, saveSettings, type GameSettings } from "./Settings";

import { MaterialLibrary } from "../world/MaterialLibrary";
import { buildDistrict, type DistrictData } from "../world/District";
import { registerShadowCasters, setupLighting } from "../world/Lighting";
import { PickupManager } from "../world/Pickups";

import { PlayerController } from "../player/PlayerController";
import { PaintMode, PAINT_RANGE } from "../paint/PaintMode";
import { SurfaceManager } from "../paint/SurfaceManager";
import { PhotoMode } from "../photo/PhotoMode";
import { Gallery } from "../photo/Gallery";
import { NPCManager } from "../npc/NPCManager";

import { Inventory } from "../progression/Inventory";
import { MissionSystem } from "../progression/Missions";
import { PlayerProfile } from "../progression/PlayerProfile";
import { SoundBank } from "../audio/SoundBank";
import { UIManager } from "../ui/UIManager";
import type { CapId } from "../paint/Palette";
import type { PieceGrade } from "../paint/PaintScoring";

const GRADE_RANK: Record<PieceGrade, number> = {
  TOY: 0,
  TAG: 1,
  THROWIE: 2,
  PIECE: 3,
  BURNER: 4,
  MASTERPIECE: 5,
};

const AUTOSAVE_INTERVAL_MS = 45_000;

/**
 * The game shell: owns the scene, the systems, and the state machine that says
 * which of them gets input on any given frame.
 *
 * Everything below is deliberately composed rather than inherited — each system
 * is independently testable and none of them reach into another's internals.
 * They talk over the event bus, and this class is the only place that knows the
 * order of operations.
 */
export class Game {
  readonly scene: Scene;
  readonly bus = new EventBus<GameEventMap>();

  private state: GameState = GameState.Boot;
  private settings: GameSettings;

  private readonly input: InputManager;
  private readonly physics = new PhysicsWorld();
  private readonly audio = new SoundBank();
  private readonly materials: MaterialLibrary;

  private district!: DistrictData;
  private surfaces!: SurfaceManager;
  private player!: PlayerController;
  private paint!: PaintMode;
  private photo!: PhotoMode;
  private npcs!: NPCManager;
  private pickups!: PickupManager;

  private readonly profile = new PlayerProfile();
  private readonly inventory = new Inventory();
  private readonly missions: MissionSystem;
  private readonly gallery = new Gallery();

  private ui!: UIManager;

  private prompt: string | null = null;
  private lastAutosave = 0;
  private photosTaken = 0;
  private chaseProximity = 0;
  private disposed = false;

  constructor(
    private readonly engine: AbstractEngine,
    canvas: HTMLCanvasElement,
    private readonly backend: string,
  ) {
    this.settings = loadSettings();
    this.scene = new Scene(engine);
    this.scene.skipPointerMovePicking = true;
    this.input = new InputManager(canvas);
    this.materials = new MaterialLibrary(this.scene);
    this.missions = new MissionSystem(this.bus);
  }

  // ------------------------------------------------------------------- setup

  async load(onProgress: (fraction: number, message: string) => void): Promise<void> {
    onProgress(0.05, "Lighting the alley…");
    const lighting = setupLighting(this.scene, "high");

    onProgress(0.18, "Starting the physics solver…");
    const havokReady = await this.physics.init(this.scene);

    onProgress(0.34, "Laying bricks…");
    this.district = buildDistrict(this.scene, this.materials, this.physics);
    registerShadowCasters(lighting, this.district.shadowCasters);

    onProgress(0.62, "Priming the walls…");
    this.surfaces = new SurfaceManager(this.scene, this.district.surfaces);
    this.pickups = new PickupManager(this.scene, this.district.stashes);

    onProgress(0.74, "Waking the neighbours…");
    this.player = new PlayerController(this.scene, this.input, this.settings);
    this.player.teleport(this.district.playerSpawn, this.district.playerSpawnYaw);
    this.npcs = new NPCManager(this.scene, this.district, this.bus, this.audio);

    this.paint = new PaintMode(
      this.scene,
      this.input,
      this.player,
      this.surfaces,
      this.inventory,
      this.audio,
      this.bus,
    );
    this.photo = new PhotoMode(this.scene, this.input, this.player, this.surfaces, this.audio);

    onProgress(0.88, "Hanging the signs…");
    this.buildUI();
    this.wireEvents();
    await this.gallery.load();

    this.audio.setVolume(this.settings.masterVolume);
    this.applyRenderScale();

    onProgress(1, havokReady ? "Ready." : "Ready (physics props disabled).");
    if (!havokReady) {
      this.bus.emit("toast", {
        text: "Havok could not start — loose props are static this session.",
        kind: "warn",
        ttl: 5000,
      });
    }
  }

  /** Hands control to the main menu and starts the render loop. */
  start(): void {
    this.ui.hideAllScreens();
    this.setState(GameState.Menu);
    this.ui.menu.setSave(SaveSystem.summary(), this.savedRankLabel());
    this.ui.menu.show();

    this.input.attach();
    this.input.onPointerLockLost = () => {
      if (this.state === GameState.Explore || this.state === GameState.Painting || this.state === GameState.Photo) {
        this.openPause();
      }
    };

    this.scene.registerBeforeRender(() => this.tick());
    this.engine.runRenderLoop(() => {
      if (!this.disposed) this.scene.render();
    });
    window.addEventListener("resize", this.onResize);
  }

  // ------------------------------------------------------------- main loop

  private tick(): void {
    if (this.disposed) return;
    const dt = Math.min(this.engine.getDeltaTime() / 1000, 0.1);

    this.ui.toasts.update();
    this.pickups.update(dt);

    switch (this.state) {
      case GameState.Explore:
        this.tickExplore(dt);
        break;
      case GameState.Painting:
        this.tickPainting(dt);
        break;
      case GameState.Photo:
        this.tickPhoto(dt);
        break;
      default:
        // Menus and modals: the world holds still.
        break;
    }

    if (this.isPlaying()) {
      this.profile.playtimeMs += dt * 1000;
      this.surfaces.update(dt, this.paint.active?.id ?? null);
      this.tickWorld(dt);
      this.updateHud(dt);
      this.maybeAutosave();
    }

    this.input.endFrame();
  }

  private isPlaying(): boolean {
    return (
      this.state === GameState.Explore ||
      this.state === GameState.Painting ||
      this.state === GameState.Photo
    );
  }

  private tickExplore(dt: number): void {
    this.player.updateLook(dt);
    this.player.update(dt);

    if (this.player.isGrounded && this.player.speed > 0.6) {
      this.audio.footstep(this.player.sprinting, this.player.isCrouching);
      // Kicking through rubbish is how the player disturbs Havok props.
      this.physics.nudge(this.player.position.add(new Vector3(0, 0.25, 0)), 1.1, 1.6);
    }

    this.updateInteractionPrompt();

    if (this.input.wasPressed("paint")) this.tryEnterPaint();
    if (this.input.wasPressed("photo")) this.enterPhoto();
    if (this.input.wasPressed("gallery")) void this.openGallery();
    if (this.input.wasPressed("interact")) this.tryInteract();
  }

  private tickPainting(dt: number): void {
    // Look is handed to the spray cursor, so no updateLook here.
    this.player.update(dt);
    this.paint.update(dt);

    if (this.paint.finishRequested) {
      this.finishPiece();
      return;
    }
    if (this.input.wasPressed("paint")) {
      this.paint.exit();
      this.setState(GameState.Explore);
      this.bus.emit("toast", { text: "Left it for now.", kind: "info", ttl: 1600 });
    }

    this.ui.paintHud.update(this.paint.hudState());
  }

  private tickPhoto(dt: number): void {
    this.player.updateLook(dt, 0.7);
    this.player.update(dt);
    this.photo.update(dt);
    this.ui.photoHud.update(this.photo.hudState(this.npcs.heat.stars));

    if (this.input.primaryPressed) void this.takePhoto();
    if (this.input.wasPressed("photo")) this.exitPhoto();
    if (this.input.wasPressed("gallery")) void this.openGallery();
  }

  /** NPCs, heat and the arrest check — runs in every playable state. */
  private tickWorld(dt: number): void {
    const hidden = this.isHidden();
    const activeSurface = this.paint.active;

    const result = this.npcs.update(dt, {
      playerPosition: this.player.position,
      playerNoise: this.player.noise,
      playerPainting: this.state === GameState.Painting && this.paint.isSpraying,
      paintingRisk: activeSurface?.risk ?? 0,
      playerCrouched: this.player.isCrouching,
      hidden,
    });

    this.lastSuspicion = result.peakSuspicion;
    this.chaseProximity =
      result.nearestOfficer === Infinity ? 0 : Math.max(0, 1 - result.nearestOfficer / 22);

    if (result.busted) this.getBusted();
  }

  private lastSuspicion = 0;

  private updateHud(dt: number): void {
    this.ui.hud.update(
      {
        fame: this.profile.fame,
        rank: this.profile.rank,
        cash: this.profile.cash,
        heatStars: this.npcs.heat.stars,
        searching: this.npcs.heat.isSearching,
        suspicion: this.lastSuspicion,
        stamina: this.player.stamina,
        prompt: this.prompt,
        fps: this.engine.getFps(),
        showFps: this.settings.showFps,
        chaseProximity: this.chaseProximity,
      },
      this.missions,
      this.inventory,
    );
    void dt;
  }

  // -------------------------------------------------------------- interaction

  private updateInteractionPrompt(): void {
    const stash = this.pickups.nearest(this.player.position);
    if (stash) {
      this.setPrompt(`[E] ${stash.label}`);
      return;
    }
    const surface = this.paint.candidate();
    if (surface) {
      const state = surface.finished ? "Add to" : surface.hasPaint ? "Continue" : "Paint";
      this.setPrompt(`[P] ${state} ${surface.label.toLowerCase()} · exposure ${Math.round(surface.risk * 100)}%`);
      return;
    }
    this.setPrompt(null);
  }

  private setPrompt(text: string | null): void {
    if (this.prompt === text) return;
    this.prompt = text;
  }

  private tryInteract(): void {
    const stash = this.pickups.nearest(this.player.position);
    if (!stash) return;
    if (!this.pickups.collect(stash.id)) return;

    this.audio.pickup();
    if (stash.kind === "refill") {
      this.inventory.refillAll();
      this.bus.emit("toast", { text: "Rack topped up.", kind: "good" });
    } else {
      const message = this.inventory.addCan(stash.colourId ?? "chrome", 1);
      this.bus.emit("toast", { text: message, kind: "good" });
    }
    this.bus.emit("paint:cansChanged", undefined);
    this.bus.emit("supplies:pickup", { label: stash.label });
  }

  private tryEnterPaint(): void {
    const surface = this.paint.candidate();
    if (!surface) {
      this.bus.emit("toast", {
        text: `Nothing paintable within ${PAINT_RANGE.toFixed(1)} m — get closer to a wall.`,
        kind: "warn",
        ttl: 2000,
      });
      return;
    }
    if (!this.inventory.canSpray()) {
      this.bus.emit("toast", { text: "No paint left. Find a stash.", kind: "warn" });
      return;
    }
    this.paint.enter(surface);
    this.setPrompt(null);
    this.setState(GameState.Painting);
  }

  private finishPiece(): void {
    const surface = this.paint.active;
    if (!surface || !surface.hasPaint) {
      this.paint.exit();
      this.setState(GameState.Explore);
      this.bus.emit("toast", { text: "Nothing on the wall yet.", kind: "warn", ttl: 1800 });
      return;
    }
    const score = this.paint.finish();
    if (!score) return;
    this.setState(GameState.Review);
  }

  private enterPhoto(): void {
    this.photo.enter();
    this.setState(GameState.Photo);
    this.ui.photoHud.update(this.photo.hudState(this.npcs.heat.stars));
  }

  private exitPhoto(): void {
    this.photo.exit();
    this.setState(GameState.Explore);
  }

  private async takePhoto(): Promise<void> {
    const record = await this.photo.capture(this.npcs.heat.stars);
    if (!record) {
      this.bus.emit("toast", { text: "Nothing of yours in frame.", kind: "warn", ttl: 1800 });
      return;
    }
    this.ui.photoHud.fireFlash();
    this.photosTaken += 1;
    await this.gallery.add(record);
    this.bus.emit("photo:taken", { record });
    this.bus.emit("toast", {
      text: `Shot: ${record.grade} · ${record.score}/100. Post it from your flicks (G) for +${record.fameValue} fame.`,
      kind: "good",
      ttl: 4200,
    });
  }

  private getBusted(): void {
    const fine = Math.min(this.profile.cash, 25 + this.npcs.heat.stars * 20);
    const cansLost = this.inventory.confiscate(1 + Math.floor(this.npcs.heat.stars / 2));

    // Fame is floored at zero, so report what was actually taken rather than
    // what the penalty would have been.
    const fameBefore = this.profile.fame;
    this.profile.spendCash(fine);
    this.profile.addFame(-Math.round(fameBefore * 0.06 + this.npcs.heat.stars * 12));
    const fameLost = fameBefore - this.profile.fame;
    this.profile.timesBusted += 1;

    this.audio.failure();
    this.npcs.resetPursuit();
    if (this.paint.isActive) this.paint.exit();
    if (this.state === GameState.Photo) this.photo.exit();

    this.player.teleport(this.district.playerSpawn, this.district.playerSpawnYaw);
    this.pickups.resetAll();

    this.bus.emit("player:busted", { reason: "caught in the act", finePaid: fine, lostCans: cansLost });
    this.bus.emit("fame:changed", {
      fame: this.profile.fame,
      rank: this.profile.rank,
      cash: this.profile.cash,
    });

    this.ui.busted.setOutcome(fine, cansLost, fameLost, this.profile.timesBusted);
    this.setState(GameState.Busted);
    this.saveGame(false);
  }

  /** True when the player is inside a hideout volume and out of sight. */
  private isHidden(): boolean {
    for (const hideout of this.district.hideouts) {
      if (Vector3.Distance(this.player.position, hideout.position) < hideout.radius) return true;
    }
    return false;
  }

  // ------------------------------------------------------------ state machine

  private setState(next: GameState): void {
    if (this.state === next) return;
    const from = this.state;
    this.state = next;

    const playing = this.isPlaying();
    this.ui.hud.setVisible(playing);
    this.ui.hud.setCompact(next === GameState.Painting || next === GameState.Photo);
    this.ui.paintHud.setVisible(next === GameState.Painting);
    this.ui.photoHud.setVisible(next === GameState.Photo);
    this.player.locked = !playing;

    if (playing) {
      this.ui.hideAllScreens();
      this.input.requestPointerLock();
    } else {
      this.input.releasePointerLock();
      this.audio.stopSpray();
    }

    if (next === GameState.Review) {
      this.ui.review.show();
    } else if (next === GameState.Busted) {
      this.ui.busted.show();
    } else if (next === GameState.Menu) {
      this.npcs.setVisible(false);
    }

    if (from === GameState.Menu && playing) this.npcs.setVisible(true);

    this.bus.emit("state:changed", { from, to: next });
  }

  private openPause(): void {
    if (!this.isPlaying()) return;
    this.ui.pause.setStats(this.profile, this.surfaces.finishedCount, this.photosTaken);
    this.stateBeforeModal = this.state;
    this.setState(GameState.Paused);
    this.ui.pause.show();
  }

  private stateBeforeModal: GameState = GameState.Explore;

  private closeModalAndResume(): void {
    this.ui.hideAllScreens();
    const target =
      this.stateBeforeModal === GameState.Painting || this.stateBeforeModal === GameState.Photo
        ? this.stateBeforeModal
        : GameState.Explore;
    this.setState(target);
  }

  private async openGallery(): Promise<void> {
    const records = await this.gallery.load();
    this.ui.gallery.setPhotos(records);
    this.stateBeforeModal = this.state;
    this.setState(GameState.Gallery);
    this.ui.hideAllScreens();
    this.ui.gallery.show();
  }

  // ------------------------------------------------------------------ session

  private newGame(): void {
    this.profile.reset();
    this.inventory.reset();
    this.missions.reset();
    this.surfaces.clearAll();
    this.npcs.resetPursuit();
    this.pickups.resetAll();
    this.photosTaken = 0;
    this.player.teleport(this.district.playerSpawn, this.district.playerSpawnYaw);
    this.bus.emit("paint:cansChanged", undefined);
    this.bus.emit("mission:updated", undefined);
    this.bus.emit("fame:changed", {
      fame: this.profile.fame,
      rank: this.profile.rank,
      cash: this.profile.cash,
    });
  }

  private continueGame(): boolean {
    const save = SaveSystem.read();
    if (!save) return false;
    this.profile.load(save.profile);
    this.inventory.load(save.inventory);
    this.surfaces.restore(save.surfaces);
    this.missions.load(save.missions, Object.keys(save.surfaces ?? {}));
    this.npcs.heat.setStars(0);
    this.player.teleport(this.district.playerSpawn, this.district.playerSpawnYaw);
    this.bus.emit("paint:cansChanged", undefined);
    this.bus.emit("mission:updated", undefined);
    return true;
  }

  private saveGame(announce = true): void {
    const ok = SaveSystem.write({
      profile: this.profile.toJSON(),
      inventory: this.inventory.toJSON(),
      missions: this.missions.toJSON(),
      surfaces: this.surfaces.serialize(),
      heatStars: this.npcs.heat.stars,
    });
    this.lastAutosave = performance.now();
    if (announce) {
      this.bus.emit("toast", {
        text: ok ? "Saved." : "Could not save — browser storage is blocked.",
        kind: ok ? "good" : "bad",
      });
    }
  }

  private maybeAutosave(): void {
    if (performance.now() - this.lastAutosave < AUTOSAVE_INTERVAL_MS) return;
    // Never autosave mid-chase; a bad checkpoint is worse than none.
    if (this.npcs.heat.isWanted) return;
    this.saveGame(false);
  }

  // ----------------------------------------------------------------- wiring

  private buildUI(): void {
    const host = document.getElementById("ui-root");
    if (!host) throw new Error("#ui-root is missing from the page.");

    this.ui = new UIManager(host, this.inventory, this.backend, {
      menu: {
        onPlay: (continueSave) => {
          void this.audio.unlock();
          if (continueSave && !this.continueGame()) this.newGame();
          if (!continueSave) this.newGame();
          this.ui.hideAllScreens();
          this.setState(GameState.Explore);
          this.bus.emit("toast", {
            text: "Head down the alley. Press P at a wall to start.",
            kind: "info",
            ttl: 5200,
          });
        },
        onGallery: () => void this.openGallery(),
        onSettings: () => {
          this.stateBeforeModal = GameState.Menu;
          this.ui.settings.render(this.settings);
          this.ui.hideAllScreens();
          this.ui.settings.show();
        },
        onWipe: () => {
          SaveSystem.erase();
          void this.gallery.clear();
          this.ui.menu.setSave(null, "");
          this.bus.emit("toast", { text: "Save wiped.", kind: "warn" });
        },
      },
      pause: {
        onResume: () => this.closeModalAndResume(),
        onSave: () => this.saveGame(true),
        onGallery: () => void this.openGallery(),
        onSettings: () => {
          this.ui.settings.render(this.settings);
          this.ui.hideAllScreens();
          this.ui.settings.show();
        },
        onQuit: () => {
          this.saveGame(false);
          this.ui.hideAllScreens();
          this.setState(GameState.Menu);
          this.ui.menu.setSave(SaveSystem.summary(), this.profile.rank);
          this.ui.menu.show();
        },
      },
      gallery: {
        onPost: (id) => void this.postPhoto(id),
        onDelete: (id) => {
          void this.gallery.remove(id).then(() => this.ui.gallery.setPhotos(this.gallery.all));
        },
        onClose: () => {
          if (this.stateBeforeModal === GameState.Menu || this.state === GameState.Menu) {
            this.ui.hideAllScreens();
            this.setState(GameState.Menu);
            this.ui.menu.setSave(SaveSystem.summary(), this.profile.rank);
            this.ui.menu.show();
          } else {
            this.closeModalAndResume();
          }
        },
      },
      onSettingsChanged: (settings) => this.applySettings(settings),
      onSettingsClosed: () => {
        this.ui.hideAllScreens();
        if (this.stateBeforeModal === GameState.Menu || this.state === GameState.Menu) {
          this.setState(GameState.Menu);
          this.ui.menu.setSave(SaveSystem.summary(), this.profile.rank);
          this.ui.menu.show();
        } else {
          this.ui.pause.setStats(this.profile, this.surfaces.finishedCount, this.photosTaken);
          this.ui.pause.show();
          this.state = GameState.Paused;
        }
      },
      onReviewContinue: () => {
        this.ui.hideAllScreens();
        this.setState(GameState.Explore);
      },
      onReviewPhoto: () => {
        this.ui.hideAllScreens();
        this.setState(GameState.Explore);
        this.enterPhoto();
      },
      onBustedContinue: () => {
        this.ui.hideAllScreens();
        this.setState(GameState.Explore);
      },
      onSelectCan: (index) => {
        this.inventory.select(index);
        this.bus.emit("paint:cansChanged", undefined);
      },
      onSelectCap: (cap: CapId) => {
        this.inventory.cap = cap;
        this.bus.emit("paint:cansChanged", undefined);
      },
    });
  }

  private wireEvents(): void {
    this.bus.on("toast", ({ text, kind, ttl }) => this.ui.toasts.push(text, kind, ttl));

    this.bus.on("paint:finished", ({ surfaceId, score }) => {
      const surface = this.surfaces.get(surfaceId);
      const { rankedUp, rank } = this.profile.addFame(score.fame);
      this.profile.addCash(Math.round(score.fame * 0.35));
      this.profile.piecesFinished += 1;
      this.profile.bestPiece = Math.max(this.profile.bestPiece, score.total);
      this.missions.notePieceFinished(surfaceId, GRADE_RANK[score.grade], surface?.risk ?? 0);
      this.audio.success();
      this.ui.review.setScore(surface?.label ?? "Wall", score, score.fame, rankedUp ? rank : null);
      this.bus.emit("fame:changed", { fame: this.profile.fame, rank, cash: this.profile.cash });
      this.saveGame(false);
    });

    this.bus.on("mission:completed", ({ id, title }) => {
      const mission = this.missions.rewardFor(id);
      if (!mission) return;
      this.profile.addFame(mission.fameReward);
      this.profile.addCash(mission.cashReward);
      this.audio.success();
      this.bus.emit("toast", {
        text: `Objective done: ${title} (+${mission.fameReward} fame, +$${mission.cashReward})`,
        kind: "good",
        ttl: 4200,
      });
    });

    this.bus.on("player:escaped", ({ fromStars }) => {
      this.missions.advance("ghost");
      this.bus.emit("toast", {
        text: `Lost them at ${fromStars} star${fromStars === 1 ? "" : "s"}.`,
        kind: "good",
        ttl: 3600,
      });
    });

    this.bus.on("heat:changed", ({ stars, searching }) => {
      if (stars > 0 && searching) return;
      if (stars === 0 && !searching) {
        this.bus.emit("toast", { text: "Streets are quiet again.", kind: "good", ttl: 2400 });
      }
    });

    this.input.onActionPressed = (action) => {
      if (action !== "pause") return;
      if (this.isPlaying()) {
        this.openPause();
      } else if (
        this.state === GameState.Paused ||
        this.state === GameState.Gallery ||
        this.state === GameState.Review ||
        this.state === GameState.Busted
      ) {
        if (this.state === GameState.Review || this.state === GameState.Busted) return;
        this.closeModalAndResume();
      }
    };
  }

  private async postPhoto(id: string): Promise<void> {
    const record = await this.gallery.markPosted(id);
    if (!record) return;
    const { rankedUp, rank } = this.profile.addFame(record.fameValue);
    this.profile.addCash(Math.round(record.fameValue * 0.4));
    this.profile.photosPosted += 1;
    this.missions.advance("flicks");
    this.audio.success();
    this.ui.gallery.setPhotos(this.gallery.all);
    this.bus.emit("photo:posted", { record, fameGain: record.fameValue });
    this.bus.emit("fame:changed", { fame: this.profile.fame, rank, cash: this.profile.cash });
    this.bus.emit("toast", {
      text: rankedUp
        ? `Posted. +${record.fameValue} fame — you're a ${rank} now.`
        : `Posted. +${record.fameValue} fame.`,
      kind: "good",
      ttl: 3600,
    });
    this.saveGame(false);
  }

  private applySettings(settings: GameSettings): void {
    this.settings = settings;
    saveSettings(settings);
    this.player.applySettings(settings);
    this.audio.setVolume(settings.masterVolume);
    this.applyRenderScale();
  }

  private applyRenderScale(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.engine.setHardwareScalingLevel(1 / (dpr * this.settings.renderScale));
  }

  private savedRankLabel(): string {
    const save = SaveSystem.read();
    if (!save) return "";
    const probe = new PlayerProfile();
    probe.load(save.profile);
    return probe.rank;
  }

  private readonly onResize = () => this.engine.resize();

  /**
   * Handles for driving the game from the console or an automated smoke test.
   * Only wired up by `main.ts` in a dev build — it never ships in `npm run build`.
   */
  debugHandle() {
    return {
      game: this,
      state: () => this.state,
      /** Drops the player at a world position, optionally facing a yaw. */
      teleport: (x: number, y: number, z: number, yaw?: number) => {
        this.player.teleport(new Vector3(x, y, z), yaw ?? 0);
      },
      /** Points the camera at a surface by id and walks up to painting range. */
      goToSurface: (id: string) => {
        const surface = this.surfaces.get(id);
        if (!surface) return false;
        const stand = surface.worldCentre.add(surface.normal.scale(1.6));
        const yaw = Math.atan2(-surface.normal.x, -surface.normal.z);
        this.player.teleport(new Vector3(stand.x, 0.2, stand.z), yaw);
        return true;
      },
      surfaceIds: () => this.surfaces.all.map((surface) => surface.id),
      surfaceCoverage: (id: string) => this.surfaces.get(id)?.coverage ?? 0,
      /** Sprays a stroke straight into a surface, bypassing input. */
      testStroke: (id: string, colour = "#ff3d7f") => {
        const surface = this.surfaces.get(id);
        if (!surface) return false;
        for (let i = 0; i <= 40; i += 1) {
          const t = i / 40;
          surface.spray(
            0.15 + t * 0.7,
            0.5 + Math.sin(t * Math.PI * 2) * 0.2,
            surface.texWidth * 0.02,
            colour,
            0.5,
            0.5,
            i > 0,
          );
        }
        surface.update(0.016, true);
        return true;
      },
      heat: (stars: number) => this.npcs.heat.setStars(stars),
      fame: () => this.profile.fame,
      camera: () => ({
        position: this.player.eyePosition.asArray(),
        rotation: this.player.camera.rotation.asArray(),
        fov: this.player.camera.fov,
      }),
      shoot: () => this.takePhoto(),
      paintState: () => ({ ...this.paint.hudState(), interact: this.input.isDown("interact") }),
    };
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener("resize", this.onResize);
    this.input.detach();
    this.audio.dispose();
    this.npcs?.dispose();
    this.pickups?.dispose();
    this.surfaces?.dispose();
    this.player?.dispose();
    this.physics.dispose();
    this.materials.dispose();
    this.scene.dispose();
  }
}
