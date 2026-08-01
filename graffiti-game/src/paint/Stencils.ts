export interface StencilDef {
  id: string;
  name: string;
  /** Aspect ratio (width / height) the stamp looks right at. */
  aspect: number;
  /** Draws the shape into a 0..1 x 0..1 unit box; the caller sets the transform. */
  path: (ctx: CanvasRenderingContext2D) => void;
}

/**
 * Stencils are vector paths rather than bitmaps so they stay crisp at any
 * stamp size and cost nothing to ship.
 */
export const STENCILS: readonly StencilDef[] = Object.freeze([
  {
    id: "crown",
    name: "Crown",
    aspect: 1.5,
    path: (ctx) => {
      ctx.beginPath();
      ctx.moveTo(0.02, 0.9);
      ctx.lineTo(0.12, 0.24);
      ctx.lineTo(0.3, 0.58);
      ctx.lineTo(0.5, 0.1);
      ctx.lineTo(0.7, 0.58);
      ctx.lineTo(0.88, 0.24);
      ctx.lineTo(0.98, 0.9);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    id: "arrow",
    name: "Arrow",
    aspect: 1.6,
    path: (ctx) => {
      ctx.beginPath();
      ctx.moveTo(0.0, 0.36);
      ctx.lineTo(0.58, 0.36);
      ctx.lineTo(0.58, 0.14);
      ctx.lineTo(1.0, 0.5);
      ctx.lineTo(0.58, 0.86);
      ctx.lineTo(0.58, 0.64);
      ctx.lineTo(0.0, 0.64);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    id: "star",
    name: "Star",
    aspect: 1,
    path: (ctx) => {
      ctx.beginPath();
      const spikes = 5;
      for (let i = 0; i < spikes * 2; i += 1) {
        const radius = i % 2 === 0 ? 0.5 : 0.21;
        const angle = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
        const x = 0.5 + Math.cos(angle) * radius;
        const y = 0.5 + Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    id: "skull",
    name: "Skull",
    aspect: 0.85,
    path: (ctx) => {
      ctx.beginPath();
      ctx.ellipse(0.5, 0.4, 0.36, 0.34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.rect(0.3, 0.62, 0.4, 0.26);
      ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.ellipse(0.36, 0.4, 0.1, 0.12, 0, 0, Math.PI * 2);
      ctx.ellipse(0.64, 0.4, 0.1, 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.rect(0.44, 0.56, 0.12, 0.12);
      ctx.fill();
      for (let i = 0; i < 3; i += 1) {
        ctx.beginPath();
        ctx.rect(0.36 + i * 0.11, 0.66, 0.04, 0.22);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
    },
  },
  {
    id: "bolt",
    name: "Bolt",
    aspect: 0.6,
    path: (ctx) => {
      ctx.beginPath();
      ctx.moveTo(0.62, 0.02);
      ctx.lineTo(0.1, 0.55);
      ctx.lineTo(0.42, 0.55);
      ctx.lineTo(0.3, 0.98);
      ctx.lineTo(0.92, 0.42);
      ctx.lineTo(0.56, 0.42);
      ctx.closePath();
      ctx.fill();
    },
  },
  {
    id: "eye",
    name: "All-Seeing",
    aspect: 1.8,
    path: (ctx) => {
      ctx.beginPath();
      ctx.moveTo(0.02, 0.5);
      ctx.quadraticCurveTo(0.5, -0.12, 0.98, 0.5);
      ctx.quadraticCurveTo(0.5, 1.12, 0.02, 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(0.5, 0.5, 0.17, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = "source-over";
      ctx.beginPath();
      ctx.arc(0.5, 0.5, 0.08, 0, Math.PI * 2);
      ctx.fill();
    },
  },
]);

const BY_ID = new Map(STENCILS.map((stencil) => [stencil.id, stencil]));

export function stencilById(id: string): StencilDef | undefined {
  return BY_ID.get(id);
}

/**
 * Stamps a stencil onto a 2D context.
 *
 * The edge is deliberately imperfect: real stencils bleed under the card, so we
 * lay a blurred pass down first and a crisp pass on top.
 */
export function drawStencil(
  ctx: CanvasRenderingContext2D,
  stencil: StencilDef,
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: number,
  colour: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.translate(-width / 2, -height / 2);
  ctx.scale(width, height);
  ctx.fillStyle = colour;

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.filter = "blur(2px)";
  stencil.path(ctx);
  ctx.restore();

  ctx.globalAlpha = 0.95;
  stencil.path(ctx);
  ctx.restore();
}
