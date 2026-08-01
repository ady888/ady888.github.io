/**
 * Painting is recorded as a list of immutable operations rather than as pixels.
 *
 * Replaying the ops rebuilds a surface exactly, which means a saved game is a
 * few kilobytes of JSON instead of a megabyte of base64 PNG per wall — and it
 * gives us undo, buffing and "time-lapse" replays for free.
 *
 * Coordinates are in texture pixels of the owning surface's canvas.
 */
export type StrokeOp =
  /** Spray segment: soft-edged stroke from (x0,y0) to (x1,y1). */
  | { k: "l"; x0: number; y0: number; x1: number; y1: number; r: number; c: string; a: number }
  /** Single dab, used for the first contact of a stroke. */
  | { k: "d"; x: number; y: number; r: number; c: string; a: number }
  /** Drip running down from a saturated point. */
  | { k: "p"; x: number; y: number; len: number; w: number; c: string }
  /** Stencil stamp. */
  | { k: "s"; id: string; x: number; y: number; w: number; h: number; rot: number; c: string }
  /** Full-surface buff (grey-out) or base coat. */
  | { k: "f"; c: string; a: number };

export interface SerializedSurface {
  /** Ops in application order. */
  ops: StrokeOp[];
  /** Cached final score so the gallery/HUD do not need to re-derive it. */
  score?: import("./PaintScoring").PieceScore;
  /** Wall-clock ms spent painting this surface across all sessions. */
  timeSpentMs: number;
  finished: boolean;
}

/** Rounds a number to one decimal — plenty of precision, much smaller JSON. */
export function q(value: number): number {
  return Math.round(value * 10) / 10;
}
