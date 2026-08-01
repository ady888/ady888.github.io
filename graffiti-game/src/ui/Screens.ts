import { DEFAULT_SETTINGS, type GameSettings } from "../core/Settings";
import type { PhotoRecord } from "../photo/Gallery";
import type { PieceScore } from "../paint/PaintScoring";
import type { PlayerProfile } from "../progression/PlayerProfile";
import type { SaveSummary } from "../core/SaveSystem";
import { clear, controlList, el, formatDuration, formatTimestamp } from "./dom";

/** Common plumbing for every full-screen panel. */
abstract class Screen {
  readonly root: HTMLElement;

  protected constructor(extraClass = "") {
    this.root = el("div", { class: `screen hidden ${extraClass}`.trim(), role: "dialog", "aria-modal": "true" });
  }

  get visible(): boolean {
    return !this.root.classList.contains("hidden");
  }

  show(): void {
    this.root.classList.remove("hidden");
    // Move focus into the panel so keyboard and screen-reader users land here.
    window.requestAnimationFrame(() => {
      this.root.querySelector<HTMLElement>("button, [tabindex]")?.focus();
    });
  }

  hide(): void {
    this.root.classList.add("hidden");
  }
}

export const CONTROL_ROWS: Array<[string, string]> = [
  ["W/A/S/D", "Move"],
  ["Shift", "Run"],
  ["Ctrl", "Crouch (quieter, and lets you paint low)"],
  ["Space", "Jump"],
  ["E", "Interact / hold to finish a piece"],
  ["P", "Enter paint mode at a surface"],
  ["F", "Raise the camera"],
  ["G", "Open your flicks"],
  ["1-9 / Wheel", "Pick a can"],
  ["Q", "Swap cap (skinny / standard / fat)"],
  ["R", "Shake the can"],
  ["T", "Stencil mode"],
  ["Z", "Undo last stroke"],
  ["B", "Lay a base coat"],
  ["Esc", "Pause"],
];

// ---------------------------------------------------------------------------

export class BootScreen extends Screen {
  private readonly bar: HTMLElement;
  private readonly status: HTMLElement;

  constructor() {
    super();
    this.bar = el("i");
    this.status = el("p", { text: "Waking the city…" });
    this.root.append(
      el(
        "div",
        { class: "boot" },
        el("h1", { text: "Alley Kings" }),
        this.status,
        el("div", { class: "progress" }, this.bar),
      ),
    );
    this.root.classList.remove("hidden");
  }

  setProgress(fraction: number, message: string): void {
    this.bar.style.width = `${Math.round(fraction * 100)}%`;
    this.status.textContent = message;
  }

  fail(message: string): void {
    this.bar.style.width = "100%";
    this.bar.style.background = "var(--danger)";
    this.status.textContent = message;
  }
}

// ---------------------------------------------------------------------------

export interface MainMenuCallbacks {
  onPlay: (continueSave: boolean) => void;
  onGallery: () => void;
  onSettings: () => void;
  onWipe: () => void;
}

export class MainMenu extends Screen {
  private readonly stats: HTMLElement;
  private readonly continueButton: HTMLButtonElement;

  constructor(callbacks: MainMenuCallbacks, backend: string) {
    super();
    this.stats = el("div");
    this.continueButton = el("button", {
      type: "button",
      class: "primary interactive",
      text: "Continue",
      onclick: () => callbacks.onPlay(true),
    }) as HTMLButtonElement;

    this.root.append(
      el(
        "div",
        { class: "menu" },
        el(
          "div",
          { class: "brand" },
          el("h1", { html: "Alley<br/>Kings" }),
          el("span", { class: "tag", text: "Back Alley District" }),
          el("p", {
            text:
              "One block, one night, one bag of cans. Find the spots, put the work up, " +
              "get the flick before anyone calls it in — and know where to disappear when they do.",
          }),
          el("p", {
            style: "font-size:.78rem;opacity:.65",
            text: `Renderer: ${backend.toUpperCase()} · everything is generated in-browser, no downloads.`,
          }),
          controlList(CONTROL_ROWS.slice(0, 8)),
        ),
        el(
          "div",
          { class: "menu-actions" },
          el("h2", { text: "Career" }),
          this.stats,
          this.continueButton,
          el("button", {
            type: "button",
            class: "interactive",
            text: "New night",
            onclick: () => callbacks.onPlay(false),
          }),
          el("button", {
            type: "button",
            class: "ghost interactive",
            text: "Your flicks",
            onclick: () => callbacks.onGallery(),
          }),
          el("button", {
            type: "button",
            class: "ghost interactive",
            text: "Settings",
            onclick: () => callbacks.onSettings(),
          }),
          el("button", {
            type: "button",
            class: "ghost interactive",
            style: "opacity:.6",
            text: "Wipe save",
            onclick: () => callbacks.onWipe(),
          }),
        ),
      ),
    );
  }

  setSave(summary: SaveSummary | null, rank: string): void {
    clear(this.stats);
    this.continueButton.disabled = summary === null;
    if (!summary) {
      this.stats.append(
        el("div", { class: "stat-row" }, el("span", { text: "No save yet" }), el("b", { text: "—" })),
      );
      return;
    }
    const rows: Array<[string, string]> = [
      ["Fame", String(summary.fame)],
      ["Rank", rank],
      ["Pieces up", String(summary.pieces)],
      ["Flicks posted", String(summary.photos)],
      ["Last played", formatTimestamp(summary.savedAt)],
    ];
    for (const [key, value] of rows) {
      this.stats.append(
        el("div", { class: "stat-row" }, el("span", { text: key }), el("b", { text: value })),
      );
    }
  }
}

// ---------------------------------------------------------------------------

export interface PauseCallbacks {
  onResume: () => void;
  onSave: () => void;
  onGallery: () => void;
  onSettings: () => void;
  onQuit: () => void;
}

export class PauseMenu extends Screen {
  private readonly stats: HTMLElement;

  constructor(callbacks: PauseCallbacks) {
    super();
    this.stats = el("div");
    this.root.append(
      el(
        "div",
        { class: "panel" },
        el("h2", { text: "Paused" }),
        el("p", { class: "sub", text: "The alley waits." }),
        this.stats,
        el(
          "div",
          { class: "row" },
          el("button", { type: "button", class: "primary interactive", text: "Resume", onclick: () => callbacks.onResume() }),
          el("button", { type: "button", class: "interactive", text: "Save", onclick: () => callbacks.onSave() }),
          el("button", { type: "button", class: "interactive", text: "Your flicks", onclick: () => callbacks.onGallery() }),
          el("button", { type: "button", class: "ghost interactive", text: "Settings", onclick: () => callbacks.onSettings() }),
          el("button", { type: "button", class: "ghost interactive", text: "Quit to menu", onclick: () => callbacks.onQuit() }),
        ),
        el("h2", { style: "font-size:1.1rem;margin-top:1.6rem", text: "Controls" }),
        controlList(CONTROL_ROWS),
      ),
    );
  }

  setStats(profile: PlayerProfile, piecesUp: number, photosTaken: number): void {
    clear(this.stats);
    const next = profile.nextRank;
    const rows: Array<[string, string]> = [
      ["Fame", `${profile.fame} (${profile.rank})`],
      ["Next rank", next ? `${next.name} in ${next.remaining} fame` : "Topped out"],
      ["Cash", `$${profile.cash}`],
      ["Pieces up", String(piecesUp)],
      ["Flicks taken", String(photosTaken)],
      ["Times nicked", String(profile.timesBusted)],
      ["Time on the street", formatDuration(profile.playtimeMs)],
    ];
    for (const [key, value] of rows) {
      this.stats.append(
        el("div", { class: "stat-row" }, el("span", { text: key }), el("b", { text: value })),
      );
    }
  }
}

// ---------------------------------------------------------------------------

export class ReviewScreen extends Screen {
  private readonly body: HTMLElement;

  constructor(onContinue: () => void, onPhoto: () => void) {
    super();
    this.body = el("div");
    this.root.append(
      el(
        "div",
        { class: "panel" },
        this.body,
        el(
          "div",
          { class: "row" },
          el("button", { type: "button", class: "primary interactive", text: "Get the flick", onclick: () => onPhoto() }),
          el("button", { type: "button", class: "interactive", text: "Walk away", onclick: () => onContinue() }),
        ),
      ),
    );
  }

  setScore(label: string, score: PieceScore, fameGain: number, rankedUp: string | null): void {
    clear(this.body);
    this.body.append(
      el("h2", { text: "Piece up" }),
      el("p", { class: "sub", text: `${label} · ${score.colours.length} colours · ${score.opCount} strokes` }),
      el("div", { class: "grade", text: score.grade }),
      el(
        "div",
        { class: "score-grid", style: "margin-top:1rem" },
        cell("Rating", `${score.total}`),
        cell("Coverage", `${Math.round(score.coverage * 100)}%`),
        cell("Control", `${Math.round(score.control * 100)}%`),
        cell("Colour", `${Math.round(score.colour * 100)}%`),
        cell("Exposure", `${Math.round(score.risk * 100)}%`),
        cell("Drips", String(score.drips)),
        cell("Fame", `+${fameGain}`),
        cell("Time", formatDuration(score.timeSpentMs)),
      ),
      rankedUp
        ? el("p", { class: "sub", style: "margin-top:1rem;color:var(--accent-2)", text: `Word travels — you're a ${rankedUp} now.` })
        : el("p", {
            class: "sub",
            style: "margin-top:1rem",
            text: "Fame from the piece is banked. Photograph it and post the flick to earn more.",
          }),
    );
  }
}

function cell(key: string, value: string): HTMLElement {
  return el("div", { class: "cell" }, el("div", { class: "k", text: key }), el("div", { class: "v", text: value }));
}

// ---------------------------------------------------------------------------

export interface GalleryCallbacks {
  onPost: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export class GalleryScreen extends Screen {
  private readonly grid: HTMLElement;
  private readonly subtitle: HTMLElement;

  constructor(private readonly callbacks: GalleryCallbacks) {
    super();
    this.grid = el("div", { class: "gallery-grid" });
    this.subtitle = el("p", { class: "sub" });
    this.root.append(
      el(
        "div",
        { class: "panel" },
        el("h2", { text: "Your flicks" }),
        this.subtitle,
        this.grid,
        el(
          "div",
          { class: "row" },
          el("button", { type: "button", class: "primary interactive", text: "Close", onclick: () => callbacks.onClose() }),
        ),
      ),
    );
  }

  setPhotos(records: PhotoRecord[]): void {
    clear(this.grid);
    const posted = records.filter((record) => record.posted).length;
    this.subtitle.textContent = records.length
      ? `${records.length} shot${records.length === 1 ? "" : "s"} · ${posted} posted. Posting a flick is what turns a piece into fame.`
      : "Nothing yet. Press F out there to raise the camera.";

    if (records.length === 0) {
      this.grid.append(
        el("div", { class: "empty-state", text: "Paint something, then photograph it." }),
      );
      return;
    }

    for (const record of records) {
      const actions = el("div", { class: "row", style: "margin-top:.5rem;gap:.35rem" });
      if (!record.posted) {
        actions.append(
          el("button", {
            type: "button",
            class: "primary interactive",
            style: "padding:.35rem .6rem;font-size:.78rem",
            text: `Post (+${record.fameValue})`,
            onclick: () => this.callbacks.onPost(record.id),
          }),
        );
      }
      actions.append(
        el("button", {
          type: "button",
          class: "ghost interactive",
          style: "padding:.35rem .6rem;font-size:.78rem",
          text: "Bin",
          onclick: () => this.callbacks.onDelete(record.id),
        }),
      );

      this.grid.append(
        el(
          "figure",
          { class: "shot", style: "margin:0" },
          record.thumbnail
            ? el("img", { src: record.thumbnail, alt: `Photo of ${record.surfaceLabel}`, loading: "lazy" })
            : el("div", { style: "aspect-ratio:16/10;background:#000" }),
          el(
            "figcaption",
            { class: "cap" },
            el("b", { text: `${record.grade} · ${record.score}/100` }),
            el("span", { text: `${record.surfaceLabel} · framing ${Math.round(record.framing * 100)}%` }),
            el("span", { text: `${record.posted ? "Posted" : "Unposted"} · ${formatTimestamp(record.takenAt)}` }),
            actions,
          ),
        ),
      );
    }
  }
}

// ---------------------------------------------------------------------------

export class SettingsScreen extends Screen {
  private readonly fields: HTMLElement;

  constructor(
    private readonly onChange: (settings: GameSettings) => void,
    onClose: () => void,
  ) {
    super();
    this.fields = el("div");
    this.root.append(
      el(
        "div",
        { class: "panel" },
        el("h2", { text: "Settings" }),
        el("p", { class: "sub", text: "Saved to this browser." }),
        this.fields,
        el(
          "div",
          { class: "row" },
          el("button", { type: "button", class: "primary interactive", text: "Done", onclick: () => onClose() }),
        ),
      ),
    );
  }

  render(settings: GameSettings): void {
    clear(this.fields);
    const current = { ...settings };
    const emit = () => this.onChange({ ...current });

    this.fields.append(
      range("Mouse sensitivity", current.mouseSensitivity, 0.2, 3, 0.05, (value) => {
        current.mouseSensitivity = value;
        emit();
      }),
      toggle("Invert vertical look", current.invertY, (value) => {
        current.invertY = value;
        emit();
      }),
      range("Field of view", current.fov, 0.6, 1.3, 0.02, (value) => {
        current.fov = value;
        emit();
      }),
      range("Render scale", current.renderScale, 0.5, 1, 0.05, (value) => {
        current.renderScale = value;
        emit();
      }),
      range("Volume", current.masterVolume, 0, 1, 0.05, (value) => {
        current.masterVolume = value;
        emit();
      }),
      toggle("Show FPS", current.showFps, (value) => {
        current.showFps = value;
        emit();
      }),
      select(
        "Renderer (needs restart)",
        current.rendererPreference,
        [
          ["auto", "Automatic (WebGPU if available)"],
          ["webgpu", "Force WebGPU"],
          ["webgl2", "Force WebGL 2"],
        ],
        (value) => {
          current.rendererPreference = value as GameSettings["rendererPreference"];
          emit();
        },
      ),
      el(
        "div",
        { class: "row" },
        el("button", {
          type: "button",
          class: "ghost interactive",
          text: "Reset to defaults",
          onclick: () => {
            Object.assign(current, DEFAULT_SETTINGS);
            this.render({ ...DEFAULT_SETTINGS });
            emit();
          },
        }),
      ),
    );
  }
}

function range(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onInput: (value: number) => void,
): HTMLElement {
  const output = el("b", { text: value.toFixed(2) });
  const input = el("input", {
    type: "range",
    class: "interactive",
    min: String(min),
    max: String(max),
    step: String(step),
    value: String(value),
    "aria-label": label,
    oninput: (event: Event) => {
      const next = Number((event.target as HTMLInputElement).value);
      output.textContent = next.toFixed(2);
      onInput(next);
    },
  });
  return el("div", { class: "field" }, el("label", { text: label }), el("div", {}, input, output));
}

function toggle(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
  const input = el("input", {
    type: "checkbox",
    class: "interactive",
    "aria-label": label,
    checked: value,
    onchange: (event: Event) => onChange((event.target as HTMLInputElement).checked),
  });
  return el("div", { class: "field" }, el("label", { text: label }), input);
}

function select(
  label: string,
  value: string,
  options: Array<[string, string]>,
  onChange: (value: string) => void,
): HTMLElement {
  const node = el("select", {
    class: "interactive",
    "aria-label": label,
    onchange: (event: Event) => onChange((event.target as HTMLSelectElement).value),
  });
  for (const [optionValue, optionLabel] of options) {
    node.append(el("option", { value: optionValue, selected: optionValue === value, text: optionLabel }));
  }
  return el("div", { class: "field" }, el("label", { text: label }), node);
}

// ---------------------------------------------------------------------------

export class BustedScreen extends Screen {
  private readonly body: HTMLElement;

  constructor(onContinue: () => void) {
    super("busted");
    this.body = el("div");
    this.root.append(
      el(
        "div",
        { class: "panel" },
        el("h2", { text: "Nicked" }),
        this.body,
        el(
          "div",
          { class: "row" },
          el("button", { type: "button", class: "primary interactive", text: "Walk it off", onclick: () => onContinue() }),
        ),
      ),
    );
  }

  setOutcome(fine: number, cansLost: number, fameLost: number, timesBusted: number): void {
    clear(this.body);
    this.body.append(
      el("p", { class: "sub", text: "Caught with a wet can in your hand. Cautioned, searched, sent home." }),
      el(
        "div",
        { class: "score-grid" },
        cell("Fine", `$${fine}`),
        cell("Cans seized", String(cansLost)),
        cell("Fame lost", String(fameLost)),
        cell("Times nicked", String(timesBusted)),
      ),
      el("p", {
        class: "sub",
        style: "margin-top:1rem",
        text: "Your pieces stay up. Crouch to stay quiet, keep walls between you and the street, and duck under the overpass when the stars are out.",
      }),
    );
  }
}
