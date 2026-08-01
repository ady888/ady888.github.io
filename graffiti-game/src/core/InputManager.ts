/**
 * Keyboard/mouse plumbing.
 *
 * Everything gameplay-facing reads *actions* rather than raw key codes, so the
 * bindings below are the single place to change if we add remapping later.
 * Mouse-look deltas accumulate between frames and are drained by the consumer.
 */
export type Action =
  | "forward"
  | "back"
  | "left"
  | "right"
  | "run"
  | "crouch"
  | "jump"
  | "interact"
  | "paint"
  | "photo"
  | "pause"
  | "gallery"
  | "shakeCan";

const BINDINGS: Record<string, Action> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
  ShiftLeft: "run",
  ShiftRight: "run",
  ControlLeft: "crouch",
  KeyC: "crouch",
  Space: "jump",
  KeyE: "interact",
  KeyP: "paint",
  KeyF: "photo",
  Escape: "pause",
  KeyG: "gallery",
  KeyR: "shakeCan",
};

export class InputManager {
  private readonly down = new Set<Action>();
  private readonly pressedThisFrame = new Set<Action>();
  private readonly rawDown = new Set<string>();
  private readonly rawPressedThisFrame = new Set<string>();

  private mouseDeltaX = 0;
  private mouseDeltaY = 0;
  private wheelDelta = 0;

  /** Left mouse button state, tracked separately from the action map. */
  primaryDown = false;
  secondaryDown = false;
  primaryPressed = false;
  secondaryPressed = false;

  pointerLocked = false;
  /** Screen-space pointer position, used when the pointer is *not* locked. */
  pointerX = 0;
  pointerY = 0;

  /** Raised when the user drops out of pointer lock (Esc, alt-tab, ...). */
  onPointerLockLost: (() => void) | null = null;
  /** Raised for keys that should act as one-shot toggles even while paused. */
  onActionPressed: ((action: Action) => void) | null = null;
  /** Raised for every key press, including ones with no bound action. */
  onKeyPressed: ((code: string) => void) | null = null;

  private readonly listeners: Array<() => void> = [];

  constructor(private readonly canvas: HTMLCanvasElement) {}

  attach(): void {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = BINDINGS[event.code];
      // Let the browser keep text-editing keys when a form control has focus.
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (event.code === "Space" || event.code.startsWith("Arrow")) event.preventDefault();
      if (this.rawDown.has(event.code)) return; // ignore auto-repeat
      this.rawDown.add(event.code);
      this.rawPressedThisFrame.add(event.code);
      this.onKeyPressed?.(event.code);
      if (!action) return;
      this.down.add(action);
      this.pressedThisFrame.add(action);
      this.onActionPressed?.(action);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      this.rawDown.delete(event.code);
      const action = BINDINGS[event.code];
      if (action) this.down.delete(action);
    };

    const onBlur = () => {
      this.down.clear();
      this.rawDown.clear();
      this.primaryDown = false;
      this.secondaryDown = false;
    };

    const onMouseMove = (event: MouseEvent) => {
      if (this.pointerLocked) {
        this.mouseDeltaX += event.movementX;
        this.mouseDeltaY += event.movementY;
      }
      const rect = this.canvas.getBoundingClientRect();
      this.pointerX = event.clientX - rect.left;
      this.pointerY = event.clientY - rect.top;
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 0) {
        this.primaryDown = true;
        this.primaryPressed = true;
      }
      if (event.button === 2) {
        this.secondaryDown = true;
        this.secondaryPressed = true;
      }
    };

    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 0) this.primaryDown = false;
      if (event.button === 2) this.secondaryDown = false;
    };

    const onWheel = (event: WheelEvent) => {
      if (!this.pointerLocked) return;
      event.preventDefault();
      this.wheelDelta += event.deltaY;
    };

    const onContextMenu = (event: Event) => event.preventDefault();

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === this.canvas;
      if (this.pointerLocked && !locked) this.onPointerLockLost?.();
      this.pointerLocked = locked;
      if (!locked) {
        this.primaryDown = false;
        this.secondaryDown = false;
      }
    };

    const bind = <K extends keyof WindowEventMap>(
      target: Window | Document | HTMLElement,
      type: K | string,
      handler: EventListenerOrEventListenerObject,
      options?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type, handler, options);
      this.listeners.push(() => target.removeEventListener(type, handler, options));
    };

    bind(window, "keydown", onKeyDown as EventListener);
    bind(window, "keyup", onKeyUp as EventListener);
    bind(window, "blur", onBlur);
    bind(window, "mousemove", onMouseMove as EventListener);
    bind(this.canvas, "mousedown", onMouseDown as EventListener);
    bind(window, "mouseup", onMouseUp as EventListener);
    bind(this.canvas, "wheel", onWheel as EventListener, { passive: false });
    bind(this.canvas, "contextmenu", onContextMenu);
    bind(document, "pointerlockchange", onPointerLockChange);
  }

  detach(): void {
    for (const dispose of this.listeners) dispose();
    this.listeners.length = 0;
  }

  requestPointerLock(): void {
    if (document.pointerLockElement === this.canvas) return;
    void this.canvas.requestPointerLock?.();
  }

  releasePointerLock(): void {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }

  isDown(action: Action): boolean {
    return this.down.has(action);
  }

  wasPressed(action: Action): boolean {
    return this.pressedThisFrame.has(action);
  }

  isKeyDown(code: string): boolean {
    return this.rawDown.has(code);
  }

  wasKeyPressed(code: string): boolean {
    return this.rawPressedThisFrame.has(code);
  }

  /** Axis helper: returns -1, 0 or 1 for a pair of opposing actions. */
  axis(negative: Action, positive: Action): number {
    return (this.isDown(positive) ? 1 : 0) - (this.isDown(negative) ? 1 : 0);
  }

  /** Drains accumulated look delta. Call once per frame. */
  consumeLook(): { x: number; y: number } {
    const delta = { x: this.mouseDeltaX, y: this.mouseDeltaY };
    this.mouseDeltaX = 0;
    this.mouseDeltaY = 0;
    return delta;
  }

  consumeWheel(): number {
    const delta = this.wheelDelta;
    this.wheelDelta = 0;
    return delta;
  }

  /** Clears one-shot state. The game loop calls this at the end of each frame. */
  endFrame(): void {
    this.pressedThisFrame.clear();
    this.rawPressedThisFrame.clear();
    this.primaryPressed = false;
    this.secondaryPressed = false;
  }
}
