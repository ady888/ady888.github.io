import type { StrokeOp } from "./StrokeTypes";

export interface PieceScore {
  /** 0..1 fraction of the surface's paintable area that carries paint. */
  coverage: number;
  /** 0..1 — how confidently strokes stayed on the surface and flowed smoothly. */
  control: number;
  /** 0..1 — reward for using more than one colour without turning it to mud. */
  colour: number;
  /** 0..1 — how visible the wall is from the street (set by the surface). */
  risk: number;
  /** Number of drips that ran. A few read as style; a lot reads as sloppy. */
  drips: number;
  /** Final 0..100 rating. */
  total: number;
  grade: PieceGrade;
  /** Fame awarded when the piece was completed. */
  fame: number;
  colours: string[];
  opCount: number;
  timeSpentMs: number;
}

export type PieceGrade = "TOY" | "TAG" | "THROWIE" | "PIECE" | "BURNER" | "MASTERPIECE";

const GRADE_THRESHOLDS: Array<[number, PieceGrade]> = [
  [88, "MASTERPIECE"],
  [72, "BURNER"],
  [55, "PIECE"],
  [38, "THROWIE"],
  [18, "TAG"],
  [0, "TOY"],
];

export interface ScoreInputs {
  ops: StrokeOp[];
  /** 0..1 occupancy of the low-resolution coverage grid. */
  coverage: number;
  /** 0..1 fraction of spray that landed on the surface rather than overspray. */
  onTargetRatio: number;
  /** Mean stroke smoothness 0..1 (1 = steady hand). */
  smoothness: number;
  /** Surface's exposure rating, 0..1. */
  risk: number;
  timeSpentMs: number;
}

export function scorePiece(inputs: ScoreInputs): PieceScore {
  const colours = new Set<string>();
  let drips = 0;
  for (const op of inputs.ops) {
    if (op.k === "p") {
      drips += 1;
      colours.add(op.c);
    } else if (op.k !== "f") {
      colours.add(op.c);
    }
  }

  // Coverage past ~55% of the wall stops adding value: a piece is not a buff.
  const coverage = clamp01(inputs.coverage);
  const coverageScore = clamp01(coverage / 0.55) * (coverage > 0.8 ? 0.85 : 1);

  const control = clamp01(inputs.onTargetRatio * 0.6 + inputs.smoothness * 0.4);

  // Two to four colours is the sweet spot; one is flat, seven is mud.
  const colourCount = colours.size;
  const colourScore =
    colourCount <= 1 ? 0.35 : colourCount <= 4 ? 0.7 + (colourCount - 2) * 0.15 : 0.75;

  // Drips are stylistic up to three, then start costing.
  const dripPenalty = drips <= 3 ? 0 : Math.min(0.22, (drips - 3) * 0.03);

  // Rushed work reads as a tag; ten minutes of fiddling is not ten times better.
  const minutes = inputs.timeSpentMs / 60000;
  const effort = clamp01(minutes / 1.5) * (minutes > 6 ? 0.9 : 1);

  const weighted =
    coverageScore * 0.34 + control * 0.26 + clamp01(colourScore) * 0.18 + effort * 0.22;

  const total = clamp01(weighted - dripPenalty) * 100;
  const grade = gradeFor(total);
  const fame = Math.round(total * (0.6 + inputs.risk * 0.9) * 1.6);

  return {
    coverage,
    control,
    colour: clamp01(colourScore),
    risk: inputs.risk,
    drips,
    total: Math.round(total),
    grade,
    fame,
    colours: [...colours],
    opCount: inputs.ops.length,
    timeSpentMs: inputs.timeSpentMs,
  };
}

export function gradeFor(total: number): PieceGrade {
  for (const [threshold, grade] of GRADE_THRESHOLDS) {
    if (total >= threshold) return grade;
  }
  return "TOY";
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
