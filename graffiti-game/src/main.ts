import "./styles/main.css";

import { createEngine } from "./core/EngineFactory";
import { Game } from "./core/Game";
import { loadSettings } from "./core/Settings";
import { BootScreen } from "./ui/Screens";

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById("render-canvas");
  const uiRoot = document.getElementById("ui-root");
  if (!(canvas instanceof HTMLCanvasElement) || !uiRoot) {
    throw new Error("Page is missing #render-canvas or #ui-root.");
  }

  // A standalone boot screen carries us until the Game builds the real UI.
  const boot = new BootScreen();
  uiRoot.append(boot.root);

  try {
    const settings = loadSettings();
    boot.setProgress(0.02, "Starting the renderer…");

    const { engine, backend, fellBack } = await createEngine(canvas, settings.rendererPreference);
    if (fellBack) {
      console.info("[main] WebGPU was advertised but unusable; running on WebGL 2.");
    }

    const game = new Game(engine, canvas, backend);
    await game.load((fraction, message) => boot.setProgress(0.05 + fraction * 0.95, message));

    boot.root.remove();
    game.start();

    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).alleyKings = game.debugHandle();
      console.info("[main] dev build — `window.alleyKings` is available.");
    }

    // Best-effort save when the tab goes away.
    window.addEventListener("pagehide", () => game.dispose(), { once: true });
  } catch (error) {
    console.error("[main] boot failed", error);
    boot.fail(
      error instanceof Error
        ? error.message
        : "Something went wrong starting the game. Check the console.",
    );
  }
}

void bootstrap();
