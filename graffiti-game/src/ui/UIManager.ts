import type { GameSettings } from "../core/Settings";
import type { Inventory } from "../progression/Inventory";
import type { CapId } from "../paint/Palette";
import { HUD, PaintHUD, PhotoHUD } from "./HUD";
import { Notifications } from "./Notifications";
import {
  BootScreen,
  BustedScreen,
  GalleryScreen,
  MainMenu,
  PauseMenu,
  ReviewScreen,
  SettingsScreen,
  type GalleryCallbacks,
  type MainMenuCallbacks,
  type PauseCallbacks,
} from "./Screens";

export interface UICallbacks {
  menu: MainMenuCallbacks;
  pause: PauseCallbacks;
  gallery: GalleryCallbacks;
  onSettingsChanged: (settings: GameSettings) => void;
  onSettingsClosed: () => void;
  onReviewContinue: () => void;
  onReviewPhoto: () => void;
  onBustedContinue: () => void;
  onSelectCan: (index: number) => void;
  onSelectCap: (cap: CapId) => void;
}

/**
 * Owns every DOM overlay and guarantees only one modal is up at a time.
 *
 * Keeping the interface in HTML rather than Babylon GUI buys us real focus
 * handling, screen-reader semantics and CSS layout for free — worth far more
 * here than drawing the menus inside the 3D canvas.
 */
export class UIManager {
  readonly root: HTMLElement;
  readonly boot: BootScreen;
  readonly menu: MainMenu;
  readonly pause: PauseMenu;
  readonly review: ReviewScreen;
  readonly gallery: GalleryScreen;
  readonly settings: SettingsScreen;
  readonly busted: BustedScreen;
  readonly hud: HUD;
  readonly paintHud: PaintHUD;
  readonly photoHud: PhotoHUD;
  readonly toasts: Notifications;

  constructor(host: HTMLElement, inventory: Inventory, backend: string, callbacks: UICallbacks) {
    this.root = host;

    this.boot = new BootScreen();
    this.menu = new MainMenu(callbacks.menu, backend);
    this.pause = new PauseMenu(callbacks.pause);
    this.review = new ReviewScreen(callbacks.onReviewContinue, callbacks.onReviewPhoto);
    this.gallery = new GalleryScreen(callbacks.gallery);
    this.settings = new SettingsScreen(callbacks.onSettingsChanged, callbacks.onSettingsClosed);
    this.busted = new BustedScreen(callbacks.onBustedContinue);

    this.hud = new HUD();
    this.paintHud = new PaintHUD(inventory, callbacks.onSelectCan, callbacks.onSelectCap);
    this.photoHud = new PhotoHUD();
    this.toasts = new Notifications();

    this.hud.setVisible(false);
    this.paintHud.setVisible(false);
    this.photoHud.setVisible(false);

    host.append(
      this.hud.root,
      this.paintHud.root,
      this.photoHud.root,
      this.boot.root,
      this.menu.root,
      this.pause.root,
      this.review.root,
      this.gallery.root,
      this.settings.root,
      this.busted.root,
    );
    this.toasts.mount(host);
  }

  /** True when any modal panel is covering the game. */
  get modalOpen(): boolean {
    return [this.boot, this.menu, this.pause, this.review, this.gallery, this.settings, this.busted].some(
      (screen) => screen.visible,
    );
  }

  hideAllScreens(): void {
    this.boot.hide();
    this.menu.hide();
    this.pause.hide();
    this.review.hide();
    this.gallery.hide();
    this.settings.hide();
    this.busted.hide();
  }
}
