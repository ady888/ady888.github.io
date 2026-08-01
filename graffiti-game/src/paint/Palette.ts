export interface PaintColour {
  id: string;
  name: string;
  hex: string;
}

/** The stock rack. Ordered roughly by how often a writer reaches for it. */
export const PALETTE: readonly PaintColour[] = Object.freeze([
  { id: "chrome", name: "Chrome", hex: "#c9ced6" },
  { id: "black", name: "Black", hex: "#141418" },
  { id: "white", name: "White", hex: "#f2f2ec" },
  { id: "red", name: "Fire Red", hex: "#e02323" },
  { id: "orange", name: "Sunset", hex: "#f26a1b" },
  { id: "yellow", name: "Cadmium", hex: "#f5d020" },
  { id: "lime", name: "Acid Lime", hex: "#7ed321" },
  { id: "green", name: "Bottle Green", hex: "#159957" },
  { id: "teal", name: "Lagoon", hex: "#12b5a5" },
  { id: "blue", name: "Ultra Blue", hex: "#2a6df4" },
  { id: "purple", name: "Violet", hex: "#8a3ffc" },
  { id: "pink", name: "Hot Pink", hex: "#ff3d7f" },
]);

const BY_ID = new Map(PALETTE.map((colour) => [colour.id, colour]));

export function colourById(id: string): PaintColour {
  return BY_ID.get(id) ?? PALETTE[0];
}

export interface CapProfile {
  id: CapId;
  name: string;
  /** Multiplier applied to the brush radius. */
  radius: number;
  /** Multiplier applied to per-tick opacity, i.e. how fast paint builds. */
  flow: number;
  /** How much overspray speckle the cap throws. */
  scatter: number;
  /** Paint drawn from the can per second of trigger. */
  drain: number;
}

export type CapId = "skinny" | "standard" | "fat";

export const CAPS: Readonly<Record<CapId, CapProfile>> = Object.freeze({
  skinny: { id: "skinny", name: "Skinny", radius: 0.45, flow: 0.85, scatter: 0.25, drain: 0.02 },
  standard: { id: "standard", name: "Standard", radius: 1, flow: 1, scatter: 0.6, drain: 0.038 },
  fat: { id: "fat", name: "Fat Cap", radius: 2.05, flow: 1.25, scatter: 1, drain: 0.075 },
});

export const CAP_ORDER: readonly CapId[] = Object.freeze(["skinny", "standard", "fat"]);
