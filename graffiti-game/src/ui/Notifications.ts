import { el } from "./dom";

export type ToastKind = "good" | "warn" | "bad" | "info";

interface LiveToast {
  node: HTMLElement;
  expiresAt: number;
}

const MAX_VISIBLE = 4;

/** Transient messages. Also mirrored into an aria-live region for screen readers. */
export class Notifications {
  readonly root: HTMLElement;
  private readonly live: HTMLElement;
  private readonly toasts: LiveToast[] = [];

  constructor() {
    this.root = el("div", { class: "toasts", "aria-hidden": "true" });
    this.live = el("div", {
      class: "sr-only",
      role: "status",
      "aria-live": "polite",
      style: "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);",
    });
  }

  mount(parent: HTMLElement): void {
    parent.append(this.root, this.live);
  }

  push(text: string, kind: ToastKind = "info", ttl = 2600): void {
    const node = el("div", { class: `toast ${kind}`, text });
    this.root.append(node);
    this.toasts.push({ node, expiresAt: performance.now() + ttl });
    this.live.textContent = text;

    while (this.toasts.length > MAX_VISIBLE) {
      const oldest = this.toasts.shift();
      oldest?.node.remove();
    }
  }

  update(): void {
    const now = performance.now();
    for (let i = this.toasts.length - 1; i >= 0; i -= 1) {
      const toast = this.toasts[i];
      if (now < toast.expiresAt) continue;
      if (!toast.node.classList.contains("leaving")) {
        toast.node.classList.add("leaving");
        toast.expiresAt = now + 240;
        continue;
      }
      toast.node.remove();
      this.toasts.splice(i, 1);
    }
  }

  clearAll(): void {
    for (const toast of this.toasts) toast.node.remove();
    this.toasts.length = 0;
  }
}
