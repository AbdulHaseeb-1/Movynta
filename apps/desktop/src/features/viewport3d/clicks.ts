/** A press that moves less than this, and ends sooner than the time limit, is a click, not a drag. */
export const CLICK_TOLERANCE_PX = 4;
/** The longest press, in milliseconds, that still counts as a click. */
export const CLICK_MAX_MS = 500;

/** Where and when a press began. */
export interface Press {
  x: number;
  y: number;
  time: number;
}

/** Whether a press released at (`x`, `y`) at time `now` was a click rather than the start of a drag or a long press. */
export function isClick(press: Press, x: number, y: number, now: number): boolean {
  return Math.hypot(x - press.x, y - press.y) <= CLICK_TOLERANCE_PX && now - press.time <= CLICK_MAX_MS;
}

/** Tracks a press to tell a click from a drag. */
export interface ClickWatch {
  /**
   * Asked when the button goes down: true leaves this press alone, for one that grabs a handle and so
   * can never be a click on the scene.
   */
  ignore?: () => boolean;
  onClick: (event: PointerEvent) => void;
  /**
   * Hear the click before the other listeners on the element, so `onClick` can claim it with
   * `preventDefault`, which makes every other `watchClicks` on the element leave it alone. A click is
   * claimed that way and not with `stopImmediatePropagation`, which would also keep the camera
   * controls, which end their drag on the same event, from ever hearing it.
   */
  capture?: boolean;
}

/** Calls `onClick` for every left-button click on `element`. Returns a function that stops watching. */
export function watchClicks(
  element: Pick<HTMLElement, "addEventListener" | "removeEventListener">,
  { ignore, onClick, capture = false }: ClickWatch,
): () => void {
  let press: Press | undefined;
  const onDown = (event: PointerEvent) => {
    press =
      event.button === 0 && !ignore?.() ? { x: event.clientX, y: event.clientY, time: performance.now() } : undefined;
  };
  const onUp = (event: PointerEvent) => {
    const started = press;
    press = undefined;
    // Someone listening earlier already took this click.
    if (event.defaultPrevented) return;
    if (started && event.button === 0 && isClick(started, event.clientX, event.clientY, performance.now()))
      onClick(event);
  };
  element.addEventListener("pointerdown", onDown);
  element.addEventListener("pointerup", onUp, capture);
  return () => {
    element.removeEventListener("pointerdown", onDown);
    element.removeEventListener("pointerup", onUp, capture);
  };
}
