/**
 * Explicit Babylon engine-extension imports.
 *
 * In Babylon's ES-module build, engine methods live in side-effect modules that
 * patch the engine prototype. Each backend has its own copy, and the barrels
 * (`Engines/engine`, `Engines/webgpuEngine`) do NOT import all of them — in
 * particular neither imports `engine.dynamicTexture`.
 *
 * The WebGL build got away with it by pulling that extension in transitively.
 * WebGPU did not, so the first WebGPU machine to run the game died on
 * "createDynamicTexture is not a function" at boot — and since every paintable
 * wall in this game is a DynamicTexture, that is fatal rather than cosmetic.
 *
 * Importing both backends' extensions here, once, removes the dependency on
 * whatever the rest of the import graph happens to drag along. If you add a
 * Babylon feature that reaches for a new engine method, add its extension here
 * for BOTH backends rather than relying on it arriving by accident.
 */

// --- WebGL 2 ---------------------------------------------------------------
import "@babylonjs/core/Engines/Extensions/engine.dynamicTexture";
import "@babylonjs/core/Engines/Extensions/engine.rawTexture";
import "@babylonjs/core/Engines/Extensions/engine.readTexture";
import "@babylonjs/core/Engines/Extensions/engine.renderTarget";
import "@babylonjs/core/Engines/Extensions/engine.renderTargetTexture";
import "@babylonjs/core/Engines/Extensions/engine.multiRender";

// --- WebGPU ----------------------------------------------------------------
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.dynamicTexture";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.rawTexture";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.readTexture";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.renderTarget";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.renderTargetTexture";
import "@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender";

/** Engine methods the game cannot run without, whichever backend is in use. */
export const REQUIRED_ENGINE_METHODS = [
  "createDynamicTexture",
  "updateDynamicTexture",
  "createRenderTargetTexture",
] as const;

/**
 * Reports which required methods are missing from a live engine.
 *
 * Called right after engine creation so a backend that is missing something can
 * be rejected in favour of one that works, instead of failing halfway through
 * building the world.
 */
export function missingEngineMethods(engine: object): string[] {
  return REQUIRED_ENGINE_METHODS.filter(
    (name) => typeof (engine as Record<string, unknown>)[name] !== "function",
  );
}
