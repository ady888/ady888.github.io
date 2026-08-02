import { PhotoStore } from "../core/Persistence";
import type { PieceGrade } from "../paint/PaintScoring";

export interface PhotoRecord {
  id: string;
  surfaceId: string | null;
  surfaceLabel: string;
  /** JPEG data URL, small enough to keep a few dozen of them around. */
  thumbnail: string;
  takenAt: number;
  /** 0..1 how well the piece was framed. */
  framing: number;
  /** The piece's own 0..100 rating at the time of the shot. */
  pieceScore: number;
  grade: PieceGrade;
  /** Wanted level when the shutter went — danger sells. */
  heatStars: number;
  /** 0..100 rating for the photo itself. */
  score: number;
  fameValue: number;
  posted: boolean;
}

const MAX_PHOTOS = 40;

/**
 * The player's flick book.
 *
 * Photos live in IndexedDB because a base64 JPEG per shot would blow through
 * the localStorage quota inside a session. Posting one is the moment fame is
 * actually paid out — painting builds the piece, the photo is what spreads it.
 */
export class Gallery {
  private readonly store = new PhotoStore();
  private records: PhotoRecord[] = [];
  private loaded = false;

  async load(): Promise<PhotoRecord[]> {
    if (this.loaded) return this.records;
    const all = await this.store.all<PhotoRecord>();
    this.records = all.sort((a, b) => b.takenAt - a.takenAt);
    this.loaded = true;
    return this.records;
  }

  get all(): PhotoRecord[] {
    return this.records;
  }

  get unposted(): PhotoRecord[] {
    return this.records.filter((record) => !record.posted);
  }

  get postedCount(): number {
    return this.records.filter((record) => record.posted).length;
  }

  /** Best photo taken of a given surface, if any. */
  bestFor(surfaceId: string): PhotoRecord | null {
    let best: PhotoRecord | null = null;
    for (const record of this.records) {
      if (record.surfaceId !== surfaceId) continue;
      if (!best || record.score > best.score) best = record;
    }
    return best;
  }

  async add(record: PhotoRecord): Promise<void> {
    this.records.unshift(record);
    await this.store.put(record);
    // Trim the oldest so a long session cannot fill the user's disk.
    while (this.records.length > MAX_PHOTOS) {
      const dropped = this.records.pop();
      if (dropped) await this.store.delete(dropped.id);
    }
  }

  async markPosted(id: string): Promise<PhotoRecord | null> {
    const record = this.records.find((entry) => entry.id === id);
    if (!record || record.posted) return null;
    record.posted = true;
    await this.store.put(record);
    return record;
  }

  async remove(id: string): Promise<void> {
    this.records = this.records.filter((record) => record.id !== id);
    await this.store.delete(id);
  }

  async clear(): Promise<void> {
    this.records = [];
    await this.store.clear();
  }
}
