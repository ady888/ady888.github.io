import { colourById } from "../paint/Palette";
import type { Inventory } from "../progression/Inventory";
import type { MissionSystem } from "../progression/Missions";
import type { PaintHudState } from "../paint/PaintMode";
import type { PhotoHudState } from "../photo/PhotoMode";
import { clear, el } from "./dom";

export interface HudFrame {
  fame: number;
  rank: string;
  cash: number;
  heatStars: number;
  searching: boolean;
  suspicion: number;
  stamina: number;
  prompt: string | null;
  fps: number;
  showFps: boolean;
  chaseProximity: number;
}

/** The always-on exploration HUD. */
export class HUD {
  readonly root: HTMLElement;

  private readonly fameValue: HTMLElement;
  private readonly rankLabel: HTMLElement;
  private readonly cashLabel: HTMLElement;
  private readonly heatRow: HTMLElement;
  private readonly heatPips: HTMLElement[] = [];
  private readonly objectiveList: HTMLElement;
  private readonly canStrip: HTMLElement;
  private readonly promptBox: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly suspicionEye: HTMLElement;
  private readonly fpsLabel: HTMLElement;
  private readonly alarmVignette: HTMLElement;

  private lastObjectiveSignature = "";
  private lastCanSignature = "";

  constructor() {
    this.fameValue = el("span", { class: "value", text: "0" });
    this.rankLabel = el("div", { class: "rank", text: "Nobody" });
    this.cashLabel = el("div", { class: "rank", text: "$40" });

    this.heatRow = el("div", { class: "heat" });
    for (let i = 0; i < 5; i += 1) {
      const pip = el("i");
      this.heatPips.push(pip);
      this.heatRow.append(pip);
    }

    this.objectiveList = el("ul");
    this.canStrip = el("div", { class: "can-strip" });
    this.promptBox = el("div", { class: "prompt hidden" });
    this.staminaFill = el("i", { style: "width:100%" });
    this.suspicionEye = el("div", { class: "rank", text: "" });
    this.fpsLabel = el("div", { class: "rank hidden" });
    this.alarmVignette = el("div", { class: "vignette-alarm" });

    this.root = el(
      "div",
      { class: "hud" },
      this.alarmVignette,
      el(
        "div",
        { class: "tl card objectives" },
        el("h3", { text: "Tonight" }),
        this.objectiveList,
      ),
      el(
        "div",
        { class: "tr card" },
        el(
          "div",
          { class: "fame" },
          el("span", { class: "label", text: "Fame" }),
          this.fameValue,
        ),
        this.rankLabel,
        this.cashLabel,
        this.heatRow,
        this.suspicionEye,
        this.fpsLabel,
      ),
      el(
        "div",
        { class: "bl card" },
        el("h3", { class: "", style: "margin:0 0 .4rem;font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:var(--ink-dim)", text: "Rack" }),
        this.canStrip,
        el("div", { class: "stamina" }, this.staminaFill),
      ),
      el("div", { class: "center" }, el("div", { class: "reticle" })),
      el("div", { class: "br" }, this.promptBox),
    );
  }

  update(frame: HudFrame, missions: MissionSystem, inventory: Inventory): void {
    this.fameValue.textContent = String(frame.fame);
    this.rankLabel.textContent = frame.rank;
    this.cashLabel.textContent = `$${frame.cash}`;

    for (let i = 0; i < this.heatPips.length; i += 1) {
      this.heatPips[i].classList.toggle("on", i < frame.heatStars);
    }
    this.heatRow.classList.toggle("searching", frame.searching);

    // Witness attention only shows once someone is actually paying attention.
    if (frame.suspicion > 0.12) {
      const bars = "▁▂▃▄▅▆▇█";
      const index = Math.min(bars.length - 1, Math.floor(frame.suspicion * bars.length));
      this.suspicionEye.textContent = `👁 ${bars[index]}`;
      this.suspicionEye.style.color = frame.suspicion > 0.7 ? "var(--danger)" : "var(--warn)";
    } else {
      this.suspicionEye.textContent = "";
    }

    this.staminaFill.style.width = `${Math.round(frame.stamina * 100)}%`;

    if (frame.prompt) {
      this.promptBox.textContent = frame.prompt;
      this.promptBox.classList.remove("hidden");
    } else {
      this.promptBox.classList.add("hidden");
    }

    this.fpsLabel.classList.toggle("hidden", !frame.showFps);
    if (frame.showFps) this.fpsLabel.textContent = `${Math.round(frame.fps)} fps`;

    this.alarmVignette.classList.toggle("on", frame.chaseProximity > 0.35);
    this.alarmVignette.style.opacity = String(Math.min(1, frame.chaseProximity));

    this.renderObjectives(missions);
    this.renderCans(inventory);
  }

  private renderObjectives(missions: MissionSystem): void {
    const active = missions.active;
    const signature = active
      .map((mission) => `${mission.id}:${mission.progress}:${mission.done}`)
      .join("|");
    if (signature === this.lastObjectiveSignature) return;
    this.lastObjectiveSignature = signature;

    clear(this.objectiveList);
    for (const mission of active) {
      const counter = mission.target > 1 ? ` (${mission.progress}/${mission.target})` : "";
      this.objectiveList.append(
        el(
          "li",
          { class: mission.done ? "done" : "" },
          el("span", { class: "box", text: mission.done ? "✔" : "▢" }),
          el("span", { text: `${mission.title}${counter}` }),
        ),
      );
    }
  }

  private renderCans(inventory: Inventory): void {
    const signature = inventory.cans
      .map((can) => `${can.colourId}:${can.amount.toFixed(2)}`)
      .join("|") + `#${inventory.selected}#${inventory.cap}`;
    if (signature === this.lastCanSignature) return;
    this.lastCanSignature = signature;

    clear(this.canStrip);
    inventory.cans.forEach((can, index) => {
      const colour = colourById(can.colourId);
      const height = 2.2 + can.amount * 0.9;
      const node = el(
        "div",
        {
          class: `can${index === inventory.selected ? " selected" : ""}${can.amount <= 0 ? " empty" : ""}`,
          style: `height:${height}rem`,
          title: `${colour.name} — ${Math.round(can.amount * 100)}%`,
        },
        el("div", {
          class: "fill",
          style: `height:${Math.round(can.amount * 100)}%;background:${colour.hex}`,
        }),
        el("div", { class: "glyph", text: String(index + 1) }),
      );
      this.canStrip.append(node);
    });
    this.canStrip.append(
      el("div", {
        class: "rank",
        style: "align-self:center;margin-left:.4rem",
        text: inventory.capProfile.name,
      }),
    );
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle("hidden", !visible);
  }

  /**
   * Paint and photo modes draw their own cursor and their own can strip, so the
   * exploration reticle and rack step out of the way rather than doubling up.
   */
  setCompact(compact: boolean): void {
    this.root.classList.toggle("compact", compact);
  }
}

/** The paint-mode overlay: swatches, cap, coverage and the spray cursor. */
export class PaintHUD {
  readonly root: HTMLElement;

  private readonly cursor: HTMLElement;
  private readonly swatches: HTMLElement;
  private readonly meta: HTMLElement;
  private readonly coverageFill: HTMLElement;
  private readonly capSeg: HTMLElement;
  private readonly finishFill: HTMLElement;
  private lastSwatchSignature = "";

  constructor(
    private readonly inventory: Inventory,
    private readonly onSelectCan: (index: number) => void,
    private readonly onSelectCap: (cap: "skinny" | "standard" | "fat") => void,
  ) {
    this.cursor = el("div", { class: "spray-cursor" });
    this.swatches = el("div", { class: "swatches" });
    this.meta = el("div", { class: "meta" });
    this.coverageFill = el("i", { style: "width:0%" });
    this.finishFill = el("i", { style: "width:0%" });
    this.capSeg = el("div", { class: "seg" });

    for (const cap of ["skinny", "standard", "fat"] as const) {
      this.capSeg.append(
        el("button", {
          type: "button",
          class: "interactive",
          "data-cap": cap,
          text: cap === "standard" ? "Std" : cap === "skinny" ? "Skinny" : "Fat",
          onclick: () => this.onSelectCap(cap),
        }),
      );
    }

    this.root = el(
      "div",
      { class: "paint-hud" },
      this.cursor,
      el(
        "div",
        { class: "paint-bar interactive" },
        this.swatches,
        el("div", { class: "divider" }),
        this.capSeg,
        el("div", { class: "divider" }),
        el(
          "div",
          { class: "meta" },
          this.meta,
          el("div", { class: "coverage" }, this.coverageFill),
          el("div", { class: "coverage", style: "margin-top:.2rem" }, this.finishFill),
        ),
      ),
    );
  }

  update(state: PaintHudState): void {
    this.cursor.style.left = `${state.cursorX}px`;
    this.cursor.style.top = `${state.cursorY}px`;
    this.cursor.style.width = `${state.cursorRadius * 2}px`;
    this.cursor.style.height = `${state.cursorRadius * 2}px`;
    this.cursor.style.borderColor = state.onSurface
      ? "rgba(255,255,255,.85)"
      : "rgba(255,80,80,.85)";
    this.cursor.style.borderStyle = state.stencilMode ? "dashed" : "solid";

    this.coverageFill.style.width = `${Math.round(Math.min(1, state.coverage / 0.55) * 100)}%`;
    this.finishFill.style.width = `${Math.round(state.finishProgress * 100)}%`;

    const pressure = Math.round(state.pressure * 100);
    this.meta.innerHTML = "";
    this.meta.append(
      el("div", {}, el("b", { text: state.surfaceLabel })),
      el("div", {
        text: `${Math.round(state.paintLeft * 100)}% paint · ${pressure}% pressure${
          state.drips > 0 ? ` · ${state.drips} running` : ""
        }`,
      }),
      el("div", {
        text: state.stencilMode
          ? `Stencil: ${state.stencilName} — [ ] to change, , . to rotate`
          : "Drag with the mouse to spray · C colour · Q cap · R shake · Z undo",
      }),
      el("div", {
        text: state.repositioning
          ? "Moving — release Shift to go back to aiming"
          : "WASD aims · hold Shift + WASD to move · hold E to finish",
      }),
    );

    for (const button of this.capSeg.querySelectorAll("button")) {
      button.classList.toggle("on", button.getAttribute("data-cap") === this.inventory.cap);
    }

    this.renderSwatches();
  }

  private renderSwatches(): void {
    const signature =
      this.inventory.cans.map((can) => `${can.colourId}:${can.amount.toFixed(2)}`).join("|") +
      `#${this.inventory.selected}`;
    if (signature === this.lastSwatchSignature) return;
    this.lastSwatchSignature = signature;

    clear(this.swatches);
    this.inventory.cans.forEach((can, index) => {
      const colour = colourById(can.colourId);
      this.swatches.append(
        el(
          "button",
          {
            type: "button",
            class: `swatch interactive${index === this.inventory.selected ? " selected" : ""}`,
            style: `background:${colour.hex}`,
            title: `${colour.name} — ${Math.round(can.amount * 100)}%`,
            "aria-label": `${colour.name}, ${Math.round(can.amount * 100)} percent`,
            disabled: can.amount <= 0.001,
            onclick: () => this.onSelectCan(index),
          },
          el("span", { class: "amount", style: `width:${Math.round(can.amount * 100)}%` }),
        ),
      );
    });
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle("hidden", !visible);
  }
}

/** The photo-mode viewfinder. */
export class PhotoHUD {
  readonly root: HTMLElement;

  private readonly readout: HTMLElement;
  private readonly framingFill: HTMLElement;
  private readonly framingLabel: HTMLElement;
  private readonly flash: HTMLElement;

  constructor() {
    this.readout = el("div", { class: "photo-readout" });
    this.framingFill = el("i", { style: "width:0%" });
    this.framingLabel = el("div", { text: "Framing" });
    this.flash = el("div", { class: "flash" });

    this.root = el(
      "div",
      { class: "photo-hud" },
      el(
        "div",
        { class: "viewfinder" },
        el("div", { class: "corner c1" }),
        el("div", { class: "corner c2" }),
        el("div", { class: "corner c3" }),
        el("div", { class: "corner c4" }),
      ),
      this.readout,
      el(
        "div",
        { class: "framing-bar" },
        this.framingLabel,
        el("div", { class: "track" }, this.framingFill),
      ),
      this.flash,
    );
  }

  update(state: PhotoHudState): void {
    this.readout.innerHTML = "";
    this.readout.append(
      el("div", { class: "rec", text: "● REC" }),
      el("div", { text: state.targetLabel ? `SUBJECT ${state.targetLabel.toUpperCase()}` : "NO SUBJECT" }),
      el("div", { text: `ZOOM ${(1 + state.zoom * 2.2).toFixed(1)}x   DIST ${state.distance.toFixed(1)}m` }),
      el("div", { text: `WANTED ${"★".repeat(state.heatStars).padEnd(5, "☆")}` }),
      el("div", { text: state.hint }),
      el("div", { text: "LMB shoot · wheel zoom · F to lower" }),
    );
    this.framingFill.style.width = `${Math.round(state.framing * 100)}%`;
    this.framingLabel.textContent = `Framing ${Math.round(state.framing * 100)}%`;
  }

  fireFlash(): void {
    this.flash.classList.remove("fire");
    // Force a reflow so the animation restarts on consecutive shots.
    void this.flash.offsetWidth;
    this.flash.classList.add("fire");
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle("hidden", !visible);
  }
}
