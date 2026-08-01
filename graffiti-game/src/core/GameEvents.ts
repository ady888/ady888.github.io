import type { PieceScore } from "../paint/PaintScoring";
import type { PhotoRecord } from "../photo/Gallery";
import type { ToastKind } from "../ui/Notifications";

/** Top-level modes the game can be in. Exactly one is active at a time. */
export enum GameState {
  Boot = "boot",
  Menu = "menu",
  Explore = "explore",
  Painting = "painting",
  Photo = "photo",
  Paused = "paused",
  Review = "review",
  Gallery = "gallery",
  Busted = "busted",
}

/** Payload contracts for every message that crosses system boundaries. */
export interface GameEventMap {
  "state:changed": { from: GameState; to: GameState };

  "player:spotted": { by: string; intensity: number };
  "player:busted": { reason: string; finePaid: number; lostCans: number };
  "player:escaped": { fromStars: number };

  "paint:started": { surfaceId: string };
  "paint:stopped": { surfaceId: string };
  "paint:finished": { surfaceId: string; score: PieceScore };
  "paint:strokeTick": { surfaceId: string; coverage: number };
  "paint:cansChanged": undefined;

  "photo:taken": { record: PhotoRecord };
  "photo:posted": { record: PhotoRecord; fameGain: number };

  "heat:changed": { stars: number; searching: boolean };
  "fame:changed": { fame: number; rank: string; cash: number };

  "mission:updated": undefined;
  "mission:completed": { id: string; title: string; fameReward: number };

  "supplies:pickup": { label: string };

  toast: { text: string; kind: ToastKind; ttl?: number };
  "prompt:changed": { text: string | null };
}
