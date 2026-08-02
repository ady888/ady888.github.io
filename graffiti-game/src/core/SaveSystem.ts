import { readJSON, removeKey, writeJSON } from "./Persistence";
import type { InventorySave } from "../progression/Inventory";
import type { MissionSave } from "../progression/Missions";
import type { ProfileSave } from "../progression/PlayerProfile";
import type { SerializedSurface } from "../paint/StrokeTypes";

const SAVE_KEY = "alleykings.save.v1";
const SAVE_VERSION = 1;

export interface SaveGame {
  version: number;
  savedAt: number;
  profile: ProfileSave;
  inventory: InventorySave;
  missions: MissionSave;
  surfaces: Record<string, SerializedSurface>;
  heatStars: number;
}

export interface SaveSummary {
  savedAt: number;
  fame: number;
  pieces: number;
  photos: number;
}

/**
 * Whole-game persistence.
 *
 * Surfaces are stored as stroke ops rather than images (see StrokeTypes), which
 * is what keeps an entire district of paintwork inside the localStorage budget.
 */
export class SaveSystem {
  static exists(): boolean {
    return readJSON<SaveGame>(SAVE_KEY) !== null;
  }

  static summary(): SaveSummary | null {
    const save = SaveSystem.read();
    if (!save) return null;
    return {
      savedAt: save.savedAt,
      fame: save.profile?.fame ?? 0,
      pieces: save.profile?.piecesFinished ?? 0,
      photos: save.profile?.photosPosted ?? 0,
    };
  }

  static read(): SaveGame | null {
    const raw = readJSON<SaveGame>(SAVE_KEY);
    if (!raw || typeof raw !== "object") return null;
    if (raw.version !== SAVE_VERSION) {
      console.warn(`[SaveSystem] ignoring save from version ${raw.version}`);
      return null;
    }
    return raw;
  }

  static write(save: Omit<SaveGame, "version" | "savedAt">): boolean {
    return writeJSON(SAVE_KEY, {
      ...save,
      version: SAVE_VERSION,
      savedAt: Date.now(),
    } satisfies SaveGame);
  }

  static erase(): void {
    removeKey(SAVE_KEY);
  }
}
