export interface ProfileSave {
  fame: number;
  cash: number;
  piecesFinished: number;
  photosPosted: number;
  timesBusted: number;
  bestPiece: number;
  playtimeMs: number;
  tag: string;
}

interface RankTier {
  fame: number;
  name: string;
}

/** Fame ladder. Reaching a tier is the game's only "level up" moment. */
const RANKS: readonly RankTier[] = Object.freeze([
  { fame: 0, name: "Nobody" },
  { fame: 120, name: "Toy" },
  { fame: 350, name: "Writer" },
  { fame: 750, name: "Bomber" },
  { fame: 1400, name: "All City" },
  { fame: 2400, name: "King" },
  { fame: 4000, name: "Legend" },
]);

/** Career stats plus the fame/cash economy. */
export class PlayerProfile {
  fame = 0;
  cash = 40;
  piecesFinished = 0;
  photosPosted = 0;
  timesBusted = 0;
  bestPiece = 0;
  playtimeMs = 0;
  tag = "RUST";

  get rank(): string {
    let name = RANKS[0].name;
    for (const tier of RANKS) if (this.fame >= tier.fame) name = tier.name;
    return name;
  }

  /** Fame needed for the next tier, or null once the ladder is topped out. */
  get nextRank(): { name: string; remaining: number } | null {
    const next = RANKS.find((tier) => tier.fame > this.fame);
    return next ? { name: next.name, remaining: next.fame - this.fame } : null;
  }

  /** Adds fame and reports whether the rank changed as a result. */
  addFame(amount: number): { rankedUp: boolean; rank: string } {
    const before = this.rank;
    this.fame = Math.max(0, Math.round(this.fame + amount));
    const after = this.rank;
    return { rankedUp: before !== after, rank: after };
  }

  addCash(amount: number): void {
    this.cash = Math.max(0, Math.round(this.cash + amount));
  }

  spendCash(amount: number): boolean {
    if (this.cash < amount) return false;
    this.cash -= amount;
    return true;
  }

  reset(): void {
    this.fame = 0;
    this.cash = 40;
    this.piecesFinished = 0;
    this.photosPosted = 0;
    this.timesBusted = 0;
    this.bestPiece = 0;
    this.playtimeMs = 0;
  }

  toJSON(): ProfileSave {
    return {
      fame: this.fame,
      cash: this.cash,
      piecesFinished: this.piecesFinished,
      photosPosted: this.photosPosted,
      timesBusted: this.timesBusted,
      bestPiece: this.bestPiece,
      playtimeMs: this.playtimeMs,
      tag: this.tag,
    };
  }

  load(save: Partial<ProfileSave> | null | undefined): void {
    if (!save) return;
    const num = (value: unknown, fallback: number) =>
      typeof value === "number" && Number.isFinite(value) ? value : fallback;
    this.fame = Math.max(0, num(save.fame, 0));
    this.cash = Math.max(0, num(save.cash, 40));
    this.piecesFinished = Math.max(0, num(save.piecesFinished, 0));
    this.photosPosted = Math.max(0, num(save.photosPosted, 0));
    this.timesBusted = Math.max(0, num(save.timesBusted, 0));
    this.bestPiece = Math.max(0, num(save.bestPiece, 0));
    this.playtimeMs = Math.max(0, num(save.playtimeMs, 0));
    if (typeof save.tag === "string" && save.tag.trim()) {
      this.tag = save.tag.trim().slice(0, 12).toUpperCase();
    }
  }
}
