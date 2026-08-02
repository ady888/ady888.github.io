const STORAGE_KEY = "alleykings.settings.v1";

export interface GameSettings {
  mouseSensitivity: number;
  invertY: boolean;
  fov: number;
  renderScale: number;
  masterVolume: number;
  rendererPreference: "auto" | "webgpu" | "webgl2";
  showFps: boolean;
}

export const DEFAULT_SETTINGS: Readonly<GameSettings> = Object.freeze({
  mouseSensitivity: 1,
  invertY: false,
  fov: 0.9,
  renderScale: 1,
  masterVolume: 0.7,
  rendererPreference: "auto",
  showFps: false,
});

export function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<GameSettings>;
    return sanitise({ ...DEFAULT_SETTINGS, ...parsed });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: GameSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitise(settings)));
  } catch (error) {
    console.warn("[Settings] could not persist settings", error);
  }
}

function sanitise(settings: GameSettings): GameSettings {
  const clamp = (value: number, min: number, max: number, fallback: number) =>
    Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  return {
    mouseSensitivity: clamp(settings.mouseSensitivity, 0.2, 3, 1),
    invertY: Boolean(settings.invertY),
    fov: clamp(settings.fov, 0.6, 1.4, 0.9),
    renderScale: clamp(settings.renderScale, 0.5, 1, 1),
    masterVolume: clamp(settings.masterVolume, 0, 1, 0.7),
    rendererPreference: (["auto", "webgpu", "webgl2"] as const).includes(
      settings.rendererPreference,
    )
      ? settings.rendererPreference
      : "auto",
    showFps: Boolean(settings.showFps),
  };
}
