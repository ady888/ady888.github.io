import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import type { Scene } from "@babylonjs/core/scene";

/**
 * Every texture in the district is generated at boot from 2D canvas ops.
 *
 * That keeps the build asset-free (no licensing, no download budget) and lets
 * us vary each wall with a seed so the alley does not read as copy-paste.
 */

/** Small, fast, deterministic PRNG (mulberry32). */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface TextureOptions {
  width?: number;
  height?: number;
  uScale?: number;
  vScale?: number;
  seed?: number;
}

function createCanvasTexture(
  name: string,
  scene: Scene,
  options: TextureOptions,
  draw: (ctx: CanvasRenderingContext2D, width: number, height: number, rng: () => number) => void,
): DynamicTexture {
  const width = options.width ?? 512;
  const height = options.height ?? 512;
  const texture = new DynamicTexture(name, { width, height }, scene, true);
  const ctx = texture.getContext() as unknown as CanvasRenderingContext2D;
  draw(ctx, width, height, makeRandom(options.seed ?? 1337));
  texture.update(true);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = options.uScale ?? 1;
  texture.vScale = options.vScale ?? 1;
  texture.anisotropicFilteringLevel = 4;
  return texture;
}

/** Speckled grain overlay used by most surfaces to break up flat colour. */
function grain(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rng: () => number,
  density: number,
  alpha: number,
): void {
  const count = Math.floor(width * height * density);
  for (let i = 0; i < count; i += 1) {
    const shade = Math.floor(rng() * 255);
    ctx.fillStyle = `rgba(${shade},${shade},${shade},${alpha})`;
    ctx.fillRect(rng() * width, rng() * height, 1 + rng() * 1.5, 1 + rng() * 1.5);
  }
}

/** Soft dark blotches — soot, damp, water staining. */
function stains(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rng: () => number,
  count: number,
  colour = "0,0,0",
  maxAlpha = 0.3,
): void {
  for (let i = 0; i < count; i += 1) {
    const x = rng() * width;
    const y = rng() * height;
    const radius = 20 + rng() * (width * 0.28);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgba(${colour},${maxAlpha * (0.4 + rng() * 0.6)})`);
    gradient.addColorStop(1, `rgba(${colour},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}

/** Vertical grime streaks running down from a horizontal band. */
function streaks(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rng: () => number,
  count: number,
  fromY: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const x = rng() * width;
    const length = height * (0.15 + rng() * 0.6);
    const gradient = ctx.createLinearGradient(x, fromY, x, fromY + length);
    gradient.addColorStop(0, `rgba(24,20,16,${0.16 + rng() * 0.2})`);
    gradient.addColorStop(1, "rgba(24,20,16,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x, fromY, 1 + rng() * 5, length);
  }
}

export function brickTexture(scene: Scene, seed: number, tint = "#6d4a3d"): DynamicTexture {
  return createCanvasTexture("tex.brick", scene, { width: 512, height: 512, seed }, (ctx, w, h, rng) => {
    ctx.fillStyle = "#3a2b25";
    ctx.fillRect(0, 0, w, h);

    const rows = 16;
    const brickH = h / rows;
    const brickW = w / 8;
    const base = hexToRgb(tint);

    for (let row = 0; row < rows; row += 1) {
      const offset = row % 2 === 0 ? 0 : brickW / 2;
      for (let col = -1; col < 9; col += 1) {
        const x = col * brickW + offset;
        const y = row * brickH;
        const variation = 0.72 + rng() * 0.5;
        ctx.fillStyle = `rgb(${clampByte(base.r * variation)},${clampByte(
          base.g * variation,
        )},${clampByte(base.b * variation)})`;
        ctx.fillRect(x + 1.5, y + 1.5, brickW - 3, brickH - 3);

        // Chipped edge on the odd brick.
        if (rng() < 0.08) {
          ctx.fillStyle = "rgba(30,24,20,0.55)";
          ctx.fillRect(x + 1.5, y + 1.5, brickW * (0.2 + rng() * 0.3), brickH * 0.35);
        }
      }
    }

    grain(ctx, w, h, rng, 0.12, 0.06);
    stains(ctx, w, h, rng, 7);
    streaks(ctx, w, h, rng, 26, 0);
  });
}

export function concreteTexture(scene: Scene, seed: number, shade = "#6a6a68"): DynamicTexture {
  return createCanvasTexture(
    "tex.concrete",
    scene,
    { width: 512, height: 512, seed },
    (ctx, w, h, rng) => {
      ctx.fillStyle = shade;
      ctx.fillRect(0, 0, w, h);

      // Broad tonal patches so the wall is not a flat grey card.
      for (let i = 0; i < 30; i += 1) {
        const x = rng() * w;
        const y = rng() * h;
        const radius = 40 + rng() * 160;
        const light = rng() > 0.5;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, light ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.09)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }

      // Form-work seams.
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.lineWidth = 2;
      for (let i = 1; i < 4; i += 1) {
        ctx.beginPath();
        ctx.moveTo(0, (h / 4) * i);
        ctx.lineTo(w, (h / 4) * i + (rng() - 0.5) * 6);
        ctx.stroke();
      }

      // Hairline cracks.
      ctx.strokeStyle = "rgba(0,0,0,0.32)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 6; i += 1) {
        let x = rng() * w;
        let y = rng() * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let step = 0; step < 14; step += 1) {
          x += (rng() - 0.5) * 26;
          y += rng() * 22;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }

      grain(ctx, w, h, rng, 0.2, 0.08);
      stains(ctx, w, h, rng, 9);
      streaks(ctx, w, h, rng, 20, h * 0.05);
    },
  );
}

export function asphaltTexture(scene: Scene, seed: number): DynamicTexture {
  return createCanvasTexture(
    "tex.asphalt",
    scene,
    { width: 512, height: 512, seed, uScale: 14, vScale: 9 },
    (ctx, w, h, rng) => {
      ctx.fillStyle = "#26262a";
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 5200; i += 1) {
        const shade = 24 + rng() * 70;
        ctx.fillStyle = `rgba(${shade},${shade},${shade + 4},${0.25 + rng() * 0.5})`;
        const size = 1 + rng() * 3;
        ctx.fillRect(rng() * w, rng() * h, size, size);
      }
      // Patched repairs and tyre polish.
      for (let i = 0; i < 5; i += 1) {
        ctx.fillStyle = `rgba(12,12,14,${0.1 + rng() * 0.2})`;
        ctx.fillRect(rng() * w, rng() * h, 40 + rng() * 160, 30 + rng() * 90);
      }
      ctx.strokeStyle = "rgba(10,10,12,0.5)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i += 1) {
        let x = rng() * w;
        let y = rng() * h;
        ctx.beginPath();
        ctx.moveTo(x, y);
        for (let step = 0; step < 10; step += 1) {
          x += (rng() - 0.5) * 60;
          y += (rng() - 0.5) * 60;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      stains(ctx, w, h, rng, 6, "0,0,0", 0.25);
    },
  );
}

export function shutterTexture(scene: Scene, seed: number, base = "#5a6068"): DynamicTexture {
  return createCanvasTexture(
    "tex.shutter",
    scene,
    { width: 512, height: 512, seed },
    (ctx, w, h, rng) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      const slat = h / 26;
      for (let y = 0; y < h; y += slat) {
        const gradient = ctx.createLinearGradient(0, y, 0, y + slat);
        gradient.addColorStop(0, "rgba(255,255,255,0.16)");
        gradient.addColorStop(0.45, "rgba(255,255,255,0.02)");
        gradient.addColorStop(0.55, "rgba(0,0,0,0.24)");
        gradient.addColorStop(1, "rgba(0,0,0,0.05)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, y, w, slat);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(0, y + slat - 2, w, 2);
      }
      // Rust creeping up from the bottom rail.
      for (let i = 0; i < 90; i += 1) {
        const x = rng() * w;
        const y = h - rng() * rng() * h * 0.55;
        const radius = 4 + rng() * 26;
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(126,66,30,${0.25 + rng() * 0.4})`);
        gradient.addColorStop(1, "rgba(126,66,30,0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      }
      // Dents.
      for (let i = 0; i < 14; i += 1) {
        ctx.fillStyle = `rgba(0,0,0,${0.1 + rng() * 0.15})`;
        ctx.beginPath();
        ctx.ellipse(rng() * w, rng() * h, 6 + rng() * 18, 4 + rng() * 8, rng() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
      grain(ctx, w, h, rng, 0.08, 0.05);
    },
  );
}

export function metalTexture(scene: Scene, seed: number, base = "#4a4d54"): DynamicTexture {
  return createCanvasTexture(
    "tex.metal",
    scene,
    { width: 256, height: 256, seed },
    (ctx, w, h, rng) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 260; i += 1) {
        ctx.strokeStyle = `rgba(255,255,255,${rng() * 0.06})`;
        ctx.lineWidth = rng() * 2;
        const y = rng() * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y + (rng() - 0.5) * 4);
        ctx.stroke();
      }
      stains(ctx, w, h, rng, 5, "94,52,24", 0.4);
      grain(ctx, w, h, rng, 0.1, 0.07);
    },
  );
}

/** Chain-link mesh with real alpha holes, for the fence panels. */
export function chainLinkTexture(scene: Scene): DynamicTexture {
  const texture = createCanvasTexture(
    "tex.chainlink",
    scene,
    { width: 128, height: 128, uScale: 10, vScale: 4 },
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      const cell = 32;
      ctx.strokeStyle = "#9aa0a8";
      for (let i = -h; i < w + h; i += cell) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + h, h);
        ctx.stroke();
      }
      ctx.strokeStyle = "#7e848c";
      for (let i = -h; i < w + h; i += cell) {
        ctx.beginPath();
        ctx.moveTo(i + h, 0);
        ctx.lineTo(i, h);
        ctx.stroke();
      }
    },
  );
  texture.hasAlpha = true;
  return texture;
}

/** A lit shop/neon sign face. Returns an emissive-friendly texture. */
export function signTexture(
  scene: Scene,
  text: string,
  ink: string,
  background: string,
  seed = 7,
): DynamicTexture {
  return createCanvasTexture(
    `tex.sign.${text}`,
    scene,
    { width: 512, height: 256, seed },
    (ctx, w, h, rng) => {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 6;
      ctx.strokeRect(10, 10, w - 20, h - 20);

      ctx.font = "bold 120px Impact, 'Arial Black', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.shadowColor = ink;
      ctx.shadowBlur = 34;
      ctx.fillStyle = ink;
      ctx.fillText(text, w / 2, h / 2 + 4);
      ctx.shadowBlur = 0;

      grain(ctx, w, h, rng, 0.05, 0.08);
      stains(ctx, w, h, rng, 3, "0,0,0", 0.35);
    },
  );
}

/** Wet-looking, patchy overlay used to make the ground read as damp. */
export function puddleTexture(scene: Scene, seed: number): DynamicTexture {
  const texture = createCanvasTexture(
    "tex.puddle",
    scene,
    { width: 256, height: 256, seed },
    (ctx, w, h, rng) => {
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h / 2;
      ctx.beginPath();
      const points = 22;
      for (let i = 0; i <= points; i += 1) {
        const angle = (i / points) * Math.PI * 2;
        const radius = (w * 0.36) * (0.62 + rng() * 0.38);
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius * 0.72;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, w * 0.4);
      gradient.addColorStop(0, "rgba(18,22,30,0.92)");
      gradient.addColorStop(0.75, "rgba(18,22,30,0.7)");
      gradient.addColorStop(1, "rgba(18,22,30,0)");
      ctx.fillStyle = gradient;
      ctx.fill();
    },
  );
  texture.hasAlpha = true;
  return texture;
}

/** Faint pre-existing tags baked into a wall so the alley has history. */
export function priorTagsTexture(scene: Scene, seed: number): DynamicTexture {
  const texture = createCanvasTexture(
    "tex.priorTags",
    scene,
    { width: 512, height: 256, seed },
    (ctx, w, h, rng) => {
      ctx.clearRect(0, 0, w, h);
      const words = ["SKUZ", "OD", "REM", "1UP", "VYNE", "KRT", "HALO", "MSK"];
      const inks = ["#101014", "#2a2f38", "#5b2020", "#1d3b52", "#3d2a4a"];
      for (let i = 0; i < 7; i += 1) {
        ctx.save();
        ctx.translate(rng() * w, 30 + rng() * (h - 60));
        ctx.rotate((rng() - 0.5) * 0.5);
        ctx.globalAlpha = 0.18 + rng() * 0.3;
        ctx.font = `bold ${28 + rng() * 46}px Impact, 'Arial Black', sans-serif`;
        ctx.fillStyle = inks[Math.floor(rng() * inks.length)];
        ctx.fillText(words[Math.floor(rng() * words.length)], 0, 0);
        ctx.restore();
      }
      // Buffed-over rectangles, the council's contribution.
      for (let i = 0; i < 3; i += 1) {
        ctx.globalAlpha = 0.22 + rng() * 0.2;
        ctx.fillStyle = "#6e6a63";
        ctx.fillRect(rng() * w, rng() * h, 60 + rng() * 150, 30 + rng() * 60);
      }
    },
  );
  texture.hasAlpha = true;
  return texture;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((char) => char + char)
          .join("")
      : value;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}
