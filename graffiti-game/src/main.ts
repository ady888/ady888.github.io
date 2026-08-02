// Engine extensions must be registered before anything touches an engine.
import "./core/BabylonSideEffects";
import "./styles/main.css";

import { createEngine } from "./core/EngineFactory";
import { Game } from "./core/Game";
import { loadSettings } from "./core/Settings";
import { BootScreen } from "./ui/Screens";

/**
 * Builds and starts the game on one renderer backend.
 *
 * Split out so the caller can retry the whole thing on WebGL 2 if a WebGPU boot
 * fails. Anything that goes wrong before the render loop starts is the caller's
 * to handle, so this rethrows rather than swallowing.
 */
async function boot(
  canvas: HTMLCanvasElement,
  boot0: BootScreen,
  preference: "auto" | "webgpu" | "webgl2",
): Promise<{ game: Game; backend: string }> {
  const { engine, backend, fellBack } = await createEngine(canvas, preference);
  if (fellBack) {
    console.info("[main] WebGPU was advertised but unusable; running on WebGL 2.");
  }

  const game = new Game(engine, canvas, backend);
  try {
    await game.load((fraction, message) => boot0.setProgress(0.05 + fraction * 0.95, message));
  } catch (error) {
    // Tear the half-built game down so a retry starts from a clean slate.
    try {
      game.dispose();
    } catch {
      /* disposal of a partially built game is best-effort */
    }
    throw error;
  }
  return { game, backend };
}

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById("render-canvas");
  const uiRoot = document.getElementById("ui-root");
  if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) {
    throw new Error("Page is missing #render-canvas or #ui-root.");
  }

  // A standalone boot screen carries us until the Game builds the real UI.
  const bootScreen = new BootScreen();
  uiRoot.append(bootScreen.root);

  const settings = loadSettings();
  bootScreen.setProgress(0.02, "Starting the renderer…");

  let started: { game: Game; backend: string } | null = null;
  try {
    started = await boot(canvas, bootScreen, settings.rendererPreference);
  } catch (error) {
    console.error("[main] boot failed", error);

    // A WebGPU-specific failure should cost the player a couple of seconds, not
    // the whole game. Retrying the entire boot on WebGL 2 covers every way that
    // backend can let us down, not just the ones we thought to check for.
    if (settings.rendererPreference !== "webgl2") {
      bootScreen.setProgress(0.05, "Renderer trouble — retrying on WebGL 2…");
      try {
        // A fresh canvas: a context has already been taken on the old one.
        const replacement = canvas.cloneNode(false) as HTMLCanvasElement;
        canvas.replaceWith(replacement);
        started = await boot(replacement, bootScreen, "webgl2");
        console.info("[main] recovered on WebGL 2 after a WebGPU failure.");
      } catch (retryError) {
        console.error("[main] WebGL 2 retry also failed", retryError);
        bootScreen.fail(describe(retryError));
        return;
      }
    } else {
      bootScreen.fail(describe(error));
      return;
    }
  }

  bootScreen.root.remove();
  started.game.start();

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).alleyKings = started.game.debugHandle();
    console.info(`[main] dev build on ${started.backend} — \`window.alleyKings\` is available.`);
  }

  // Best-effort save when the tab goes away.
  window.addEventListener("pagehide", () => started.game.dispose(), { once: true });
}

function describe(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong starting the game. Check the browser console.";
}

void bootstrap();
