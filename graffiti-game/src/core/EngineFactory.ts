import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import type { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";

export interface EngineBootResult {
  engine: AbstractEngine;
  backend: "webgpu" | "webgl2";
  /** True when the browser advertised WebGPU but we still fell back. */
  fellBack: boolean;
}

/**
 * Create the best renderer the browser can give us.
 *
 * WebGPU is preferred when it is genuinely usable; any failure during async
 * initialisation falls back to WebGL 2, which is our minimum target. A browser
 * without WebGL 2 is rejected outright rather than limping along on WebGL 1.
 */
export async function createEngine(
  canvas: HTMLCanvasElement,
  preference: "auto" | "webgpu" | "webgl2" = "auto",
): Promise<EngineBootResult> {
  let fellBack = false;

  if (preference !== "webgl2" && (await isWebGPUUsable())) {
    try {
      const engine = new WebGPUEngine(canvas, {
        antialias: true,
        stencil: true,
        powerPreference: "high-performance",
      });
      await engine.initAsync();
      return { engine, backend: "webgpu", fellBack: false };
    } catch (error) {
      console.warn("[EngineFactory] WebGPU init failed, falling back to WebGL 2.", error);
      fellBack = true;
    }
  }

  if (!hasWebGL2(canvas)) {
    throw new Error(
      "This game needs WebGL 2. Update your browser, or enable hardware acceleration and reload.",
    );
  }

  const engine = new Engine(canvas, true, {
    antialias: true,
    stencil: true,
    preserveDrawingBuffer: true, // needed so photo mode can read the framebuffer
    powerPreference: "high-performance",
    failIfMajorPerformanceCaveat: false,
  });
  engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio || 1, 2));
  return { engine, backend: "webgl2", fellBack };
}

async function isWebGPUUsable(): Promise<boolean> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return false;
  try {
    return await WebGPUEngine.IsSupportedAsync;
  } catch {
    return false;
  }
}

function hasWebGL2(canvas: HTMLCanvasElement): boolean {
  try {
    // Probe on a throwaway canvas so we do not burn the real one's context.
    const probe = document.createElement("canvas");
    probe.width = probe.height = 1;
    return Boolean(probe.getContext("webgl2"));
  } catch {
    return Boolean(canvas.getContext("webgl2"));
  }
}
