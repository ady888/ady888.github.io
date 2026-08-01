import type { EventBus } from "../core/EventBus";
import type { GameEventMap } from "../core/GameEvents";

export interface MissionDef {
  id: string;
  title: string;
  hint: string;
  target: number;
  fameReward: number;
  cashReward: number;
}

export interface MissionState {
  progress: number;
  done: boolean;
}

export type MissionSave = Record<string, MissionState>;

/**
 * The vertical slice's objective list — deliberately short, and each entry
 * teaches one system: painting, surface variety, quality, risk, photography and
 * evading the law.
 */
export const MISSIONS: readonly MissionDef[] = Object.freeze([
  {
    id: "first_piece",
    title: "Break the wall in",
    hint: "Finish one piece — press P at a surface, spray, then hold E to step back.",
    target: 1,
    fameReward: 60,
    cashReward: 25,
  },
  {
    id: "three_spots",
    title: "Three spots, one night",
    hint: "Paint three different surfaces in the alley.",
    target: 3,
    fameReward: 140,
    cashReward: 60,
  },
  {
    id: "burner",
    title: "Put up a burner",
    hint: "Score a BURNER or better on a single piece.",
    target: 1,
    fameReward: 220,
    cashReward: 90,
  },
  {
    id: "heaven_spot",
    title: "Heaven spot",
    hint: "Paint a high-exposure surface — the fire escape or the street-facing gable.",
    target: 1,
    fameReward: 180,
    cashReward: 75,
  },
  {
    id: "flicks",
    title: "Get the flicks",
    hint: "Photograph and post three of your pieces (F to raise the camera).",
    target: 3,
    fameReward: 160,
    cashReward: 70,
  },
  {
    id: "ghost",
    title: "Ghost",
    hint: "Shake a police chase at three stars or higher.",
    target: 1,
    fameReward: 200,
    cashReward: 110,
  },
]);

export class MissionSystem {
  private readonly state = new Map<string, MissionState>();
  private readonly paintedSurfaces = new Set<string>();

  constructor(private readonly bus: EventBus<GameEventMap>) {
    this.reset();
  }

  reset(): void {
    this.state.clear();
    this.paintedSurfaces.clear();
    for (const mission of MISSIONS) this.state.set(mission.id, { progress: 0, done: false });
  }

  get all(): Array<MissionDef & MissionState> {
    return MISSIONS.map((mission) => ({
      ...mission,
      ...(this.state.get(mission.id) ?? { progress: 0, done: false }),
    }));
  }

  /** The next two unfinished objectives — all the HUD has room for. */
  get active(): Array<MissionDef & MissionState> {
    const open = this.all.filter((mission) => !mission.done);
    const recentlyDone = this.all.filter((mission) => mission.done).slice(-1);
    return [...open.slice(0, 3), ...recentlyDone];
  }

  get completedCount(): number {
    return this.all.filter((mission) => mission.done).length;
  }

  advance(id: string, by = 1): void {
    const mission = MISSIONS.find((entry) => entry.id === id);
    const state = this.state.get(id);
    if (!mission || !state || state.done) return;
    state.progress = Math.min(mission.target, state.progress + by);
    if (state.progress >= mission.target) {
      state.done = true;
      this.bus.emit("mission:completed", {
        id: mission.id,
        title: mission.title,
        fameReward: mission.fameReward,
      });
    }
    this.bus.emit("mission:updated", undefined);
  }

  /** Called when a piece is finished, so surface-variety goals can tick. */
  notePieceFinished(surfaceId: string, gradeRank: number, risk: number): void {
    this.advance("first_piece");
    if (!this.paintedSurfaces.has(surfaceId)) {
      this.paintedSurfaces.add(surfaceId);
      this.advance("three_spots");
    }
    if (gradeRank >= 4) this.advance("burner");
    if (risk >= 0.72) this.advance("heaven_spot");
  }

  rewardFor(id: string): MissionDef | undefined {
    return MISSIONS.find((mission) => mission.id === id);
  }

  toJSON(): MissionSave {
    const out: MissionSave = {};
    for (const [id, state] of this.state) out[id] = { ...state };
    out.__surfaces = { progress: this.paintedSurfaces.size, done: false };
    return out;
  }

  load(save: MissionSave | null | undefined, paintedSurfaceIds: string[] = []): void {
    this.reset();
    if (save) {
      for (const mission of MISSIONS) {
        const entry = save[mission.id];
        if (!entry) continue;
        this.state.set(mission.id, {
          progress: Math.max(0, Math.min(mission.target, entry.progress ?? 0)),
          done: Boolean(entry.done),
        });
      }
    }
    for (const id of paintedSurfaceIds) this.paintedSurfaces.add(id);
  }
}
