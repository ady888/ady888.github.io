/**
 * Guided artworks: pieces the game can walk the player through.
 *
 * A stroke is a polyline in artwork space — x and y both 0..1, y up — so the
 * same artwork can be projected onto any surface at any size. Points are
 * deliberately sparse; the follower resamples them by arc length, so the
 * spacing here only has to describe the shape, not the drawing rate.
 */
export interface GuidedStroke {
  /** Palette id the guide asks for. The player can ignore it; scoring notices. */
  colourId: string;
  /** Line weight relative to the artwork's base width. */
  weight: number;
  /** Polyline in 0..1 artwork space, y up. */
  points: Array<[number, number]>;
}

export interface GuidedArtwork {
  id: string;
  name: string;
  /** Width / height of the artwork box. */
  aspect: number;
  /** How wide the piece wants to be on a wall, in metres. */
  preferredWidth: number;
  /** Fame multiplier for finishing it as guided. */
  fameBonus: number;
  strokes: GuidedStroke[];
}

/** Bubble-letter outline helpers, so the wordmarks stay readable as polylines. */
function bubbleV(x: number, w: number): Array<[number, number]> {
  return [
    [x, 0.86],
    [x + w * 0.16, 0.86],
    [x + w * 0.5, 0.24],
    [x + w * 0.84, 0.86],
    [x + w, 0.86],
    [x + w * 0.56, 0.1],
    [x + w * 0.44, 0.1],
    [x, 0.86],
  ];
}

function bubbleO(x: number, w: number): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  const cx = x + w / 2;
  const cy = 0.48;
  for (let i = 0; i <= 18; i += 1) {
    const angle = (i / 18) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * w * 0.46, cy + Math.sin(angle) * 0.38]);
  }
  return points;
}

function bubbleL(x: number, w: number): Array<[number, number]> {
  return [
    [x + w * 0.08, 0.86],
    [x + w * 0.08, 0.12],
    [x + w * 0.34, 0.12],
    [x + w * 0.34, 0.62],
    [x + w * 0.94, 0.62],
    [x + w * 0.94, 0.86],
    [x + w * 0.08, 0.86],
  ];
}

function bubbleT(x: number, w: number): Array<[number, number]> {
  return [
    [x, 0.86],
    [x + w, 0.86],
    [x + w, 0.64],
    [x + w * 0.64, 0.64],
    [x + w * 0.64, 0.1],
    [x + w * 0.36, 0.1],
    [x + w * 0.36, 0.64],
    [x, 0.64],
    [x, 0.86],
  ];
}

export const GUIDED_ARTWORKS: readonly GuidedArtwork[] = Object.freeze([
  {
    id: "volt",
    name: "VOLT throw-up",
    aspect: 2.6,
    preferredWidth: 4.6,
    fameBonus: 1.35,
    strokes: [
      { colourId: "chrome", weight: 1.15, points: bubbleV(0.02, 0.22) },
      { colourId: "chrome", weight: 1.15, points: bubbleO(0.27, 0.22) },
      { colourId: "chrome", weight: 1.15, points: bubbleL(0.52, 0.2) },
      { colourId: "chrome", weight: 1.15, points: bubbleT(0.75, 0.22) },
      // Outline pass: a slash through the middle and a drop shadow bar.
      {
        colourId: "black",
        weight: 0.75,
        points: [
          [0.0, 0.94],
          [1.0, 0.94],
        ],
      },
    ],
  },
  {
    id: "crown",
    name: "Crown tag",
    aspect: 1.6,
    preferredWidth: 2.6,
    fameBonus: 1.15,
    strokes: [
      {
        colourId: "yellow",
        weight: 1.3,
        points: [
          [0.04, 0.82],
          [0.16, 0.2],
          [0.34, 0.58],
          [0.5, 0.06],
          [0.66, 0.58],
          [0.84, 0.2],
          [0.96, 0.82],
          [0.04, 0.82],
        ],
      },
      {
        colourId: "black",
        weight: 0.7,
        points: [
          [0.1, 0.9],
          [0.9, 0.9],
        ],
      },
    ],
  },
  {
    id: "arrowtag",
    name: "Arrow tag",
    aspect: 2.2,
    preferredWidth: 3.2,
    fameBonus: 1.1,
    strokes: [
      {
        colourId: "pink",
        weight: 1.2,
        points: [
          [0.03, 0.3],
          [0.2, 0.72],
          [0.36, 0.3],
          [0.52, 0.72],
          [0.68, 0.3],
        ],
      },
      {
        colourId: "pink",
        weight: 1.0,
        points: [
          [0.62, 0.5],
          [0.96, 0.5],
          [0.84, 0.34],
        ],
      },
      {
        colourId: "pink",
        weight: 1.0,
        points: [
          [0.96, 0.5],
          [0.84, 0.66],
        ],
      },
    ],
  },
]);

export function artworkById(id: string): GuidedArtwork | undefined {
  return GUIDED_ARTWORKS.find((artwork) => artwork.id === id);
}

/** A stroke resampled to even arc-length steps, with its total length. */
export interface ResampledStroke {
  colourId: string;
  weight: number;
  /** Evenly spaced points in artwork space. */
  points: Array<[number, number]>;
  /** Cumulative arc length at each point; last entry is the total. */
  lengths: number[];
  total: number;
}

/**
 * Resamples a stroke so the follower can move along it at a constant rate.
 *
 * Working in arc length rather than in point indices is what stops the guide
 * racing through closely spaced points and crawling through sparse ones.
 */
export function resampleStroke(stroke: GuidedStroke, step = 0.01): ResampledStroke {
  const source = stroke.points;
  const points: Array<[number, number]> = [];
  const lengths: number[] = [];
  let accumulated = 0;

  if (source.length === 0) {
    return { colourId: stroke.colourId, weight: stroke.weight, points, lengths, total: 0 };
  }

  points.push([source[0][0], source[0][1]]);
  lengths.push(0);

  for (let i = 1; i < source.length; i += 1) {
    const [x0, y0] = source[i - 1];
    const [x1, y1] = source[i];
    const segment = Math.hypot(x1 - x0, y1 - y0);
    if (segment <= 1e-6) continue;
    const count = Math.max(1, Math.ceil(segment / step));
    for (let k = 1; k <= count; k += 1) {
      const t = k / count;
      points.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
      accumulated += segment / count;
      lengths.push(accumulated);
    }
  }

  return {
    colourId: stroke.colourId,
    weight: stroke.weight,
    points,
    lengths,
    total: accumulated,
  };
}

/** Point and tangent at a given arc length along a resampled stroke. */
export function sampleAt(
  stroke: ResampledStroke,
  distance: number,
): { x: number; y: number; tx: number; ty: number } {
  if (stroke.points.length === 0) return { x: 0, y: 0, tx: 1, ty: 0 };
  const clamped = Math.max(0, Math.min(distance, stroke.total));

  // Binary search the cumulative-length table.
  let low = 0;
  let high = stroke.lengths.length - 1;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (stroke.lengths[mid] < clamped) low = mid + 1;
    else high = mid;
  }
  const index = Math.max(1, low);
  const previous = stroke.points[index - 1];
  const current = stroke.points[index];
  const span = stroke.lengths[index] - stroke.lengths[index - 1] || 1;
  const t = (clamped - stroke.lengths[index - 1]) / span;

  const x = previous[0] + (current[0] - previous[0]) * t;
  const y = previous[1] + (current[1] - previous[1]) * t;
  const dx = current[0] - previous[0];
  const dy = current[1] - previous[1];
  const length = Math.hypot(dx, dy) || 1;
  return { x, y, tx: dx / length, ty: dy / length };
}
