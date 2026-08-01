import { CAP_ORDER, CAPS, PALETTE, colourById, type CapId, type PaintColour } from "../paint/Palette";

export interface CanState {
  colourId: string;
  /** 0..1 remaining paint. */
  amount: number;
  /** Pressure builds when you shake the can and bleeds off as you spray. */
  pressure: number;
}

export interface InventorySave {
  cans: CanState[];
  selected: number;
  cap: CapId;
  unlockedStencils: string[];
}

/**
 * The player's rack of cans, the cap currently screwed on, and stencil unlocks.
 *
 * A can that runs dry stays in the rack (an empty can is still a can you have
 * to carry) but cannot be selected for spraying until refilled at a stash.
 */
export class Inventory {
  cans: CanState[] = [];
  selected = 0;
  cap: CapId = "standard";
  unlockedStencils = new Set<string>(["crown", "arrow"]);

  constructor() {
    this.reset();
  }

  reset(): void {
    this.cans = [
      { colourId: "chrome", amount: 1, pressure: 1 },
      { colourId: "black", amount: 1, pressure: 1 },
      { colourId: "pink", amount: 0.8, pressure: 1 },
      { colourId: "blue", amount: 0.8, pressure: 1 },
      { colourId: "yellow", amount: 0.6, pressure: 1 },
    ];
    this.selected = 0;
    this.cap = "standard";
    this.unlockedStencils = new Set(["crown", "arrow"]);
  }

  get current(): CanState | null {
    return this.cans[this.selected] ?? null;
  }

  get currentColour(): PaintColour {
    return colourById(this.current?.colourId ?? "chrome");
  }

  get capProfile() {
    return CAPS[this.cap];
  }

  /** True when the selected can can actually put paint on a wall right now. */
  canSpray(): boolean {
    const can = this.current;
    return Boolean(can && can.amount > 0.001);
  }

  select(index: number): void {
    if (index >= 0 && index < this.cans.length) this.selected = index;
  }

  /** Cycles to the next can that still has paint in it. */
  cycle(direction: number): void {
    if (this.cans.length === 0) return;
    const count = this.cans.length;
    for (let step = 1; step <= count; step += 1) {
      const index = (this.selected + direction * step + count * count) % count;
      if (this.cans[index].amount > 0.001) {
        this.selected = index;
        return;
      }
    }
  }

  cycleCap(direction = 1): CapId {
    const index = CAP_ORDER.indexOf(this.cap);
    const next = (index + direction + CAP_ORDER.length) % CAP_ORDER.length;
    this.cap = CAP_ORDER[next];
    return this.cap;
  }

  /**
   * Draws paint. Pressure falls as the can empties and while the trigger is
   * held, which is what makes the spray sputter and forces a shake.
   */
  consume(seconds: number): number {
    const can = this.current;
    if (!can || can.amount <= 0) return 0;
    const used = Math.min(can.amount, this.capProfile.drain * seconds);
    can.amount -= used;
    can.pressure = Math.max(0.18, can.pressure - seconds * 0.16);
    if (can.amount <= 0.0005) can.amount = 0;
    return used;
  }

  /** Pressure recovers slowly on its own, and instantly-ish when shaken. */
  restPressure(seconds: number): void {
    const can = this.current;
    if (!can) return;
    can.pressure = Math.min(1, can.pressure + seconds * 0.05);
  }

  shake(): boolean {
    const can = this.current;
    if (!can || can.amount <= 0) return false;
    if (can.pressure > 0.95) return false;
    can.pressure = 1;
    return true;
  }

  /** Adds a can of a colour, or tops up an existing one. Returns a label. */
  addCan(colourId: string, amount = 1): string {
    const colour = colourById(colourId);
    const existing = this.cans.find((can) => can.colourId === colour.id);
    if (existing && existing.amount < 0.999) {
      existing.amount = Math.min(1, existing.amount + amount);
      existing.pressure = 1;
      return `${colour.name} topped up`;
    }
    if (this.cans.length >= 8) {
      // Rack is full: dump the paint into the emptiest can we are carrying.
      const emptiest = [...this.cans].sort((a, b) => a.amount - b.amount)[0];
      emptiest.colourId = colour.id;
      emptiest.amount = 1;
      emptiest.pressure = 1;
      return `Swapped a dead can for ${colour.name}`;
    }
    this.cans.push({ colourId: colour.id, amount, pressure: 1 });
    return `Picked up ${colour.name}`;
  }

  refillAll(): void {
    for (const can of this.cans) {
      can.amount = 1;
      can.pressure = 1;
    }
  }

  /** Police confiscate stock. Returns how many cans were emptied. */
  confiscate(count: number): number {
    const withPaint = this.cans.filter((can) => can.amount > 0);
    const victims = withPaint
      .sort((a, b) => b.amount - a.amount)
      .slice(0, Math.max(0, Math.min(count, withPaint.length)));
    for (const can of victims) can.amount = 0;
    return victims.length;
  }

  unlockStencil(id: string): void {
    this.unlockedStencils.add(id);
  }

  toJSON(): InventorySave {
    return {
      cans: this.cans.map((can) => ({ ...can })),
      selected: this.selected,
      cap: this.cap,
      unlockedStencils: [...this.unlockedStencils],
    };
  }

  load(save: Partial<InventorySave> | null | undefined): void {
    if (!save) return;
    const validIds = new Set(PALETTE.map((colour) => colour.id));
    if (Array.isArray(save.cans) && save.cans.length > 0) {
      this.cans = save.cans
        .filter((can) => can && validIds.has(can.colourId))
        .map((can) => ({
          colourId: can.colourId,
          amount: clamp(can.amount, 0, 1),
          pressure: clamp(can.pressure ?? 1, 0, 1),
        }));
    }
    if (this.cans.length === 0) this.reset();
    this.selected = Math.min(Math.max(0, save.selected ?? 0), this.cans.length - 1);
    this.cap = save.cap && CAPS[save.cap] ? save.cap : "standard";
    if (Array.isArray(save.unlockedStencils)) {
      this.unlockedStencils = new Set(save.unlockedStencils);
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
