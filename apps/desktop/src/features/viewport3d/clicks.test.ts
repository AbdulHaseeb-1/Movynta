import { describe, expect, it } from "vitest";
import { CLICK_MAX_MS, CLICK_TOLERANCE_PX, isClick, watchClicks } from "./clicks";

const press = { x: 100, y: 100, time: 1000 };

describe("telling a click from a drag", () => {
  it("is a click when the pointer barely moved and the button came up soon", () => {
    expect(isClick(press, 100, 100, 1100)).toBe(true);
    expect(isClick(press, 100 + CLICK_TOLERANCE_PX, 100, 1100)).toBe(true);
    expect(isClick(press, 100, 100 - 2, 1000 + CLICK_MAX_MS)).toBe(true);
  });

  it("is a drag when the pointer moved further than the tolerance, in any direction", () => {
    expect(isClick(press, 100 + CLICK_TOLERANCE_PX + 1, 100, 1100)).toBe(false);
    expect(isClick(press, 100, 100 - 20, 1100)).toBe(false);
    expect(isClick(press, 103, 103, 1100)).toBe(false);
  });

  it("is a long press when the button was held too long, however still the pointer was", () => {
    expect(isClick(press, 100, 100, 1000 + CLICK_MAX_MS + 1)).toBe(false);
  });
});

/** A canvas stand-in that takes listeners and can be sent pointer events. */
function canvas() {
  const target = new EventTarget();
  const send = (type: "pointerdown" | "pointerup", init: { button?: number; x?: number; y?: number } = {}) => {
    const event = Object.assign(new Event(type, { cancelable: true }), {
      button: init.button ?? 0,
      clientX: init.x ?? 10,
      clientY: init.y ?? 10,
    });
    target.dispatchEvent(event);
    return event;
  };
  // watchClicks only needs the listener methods of an element.
  return { element: target as unknown as HTMLElement, send };
}

describe("watching clicks", () => {
  it("reports a click, and not a press that moved or came from another button", () => {
    const { element, send } = canvas();
    const clicks: number[] = [];
    watchClicks(element, { onClick: (event) => clicks.push(event.clientX) });
    send("pointerdown");
    send("pointerup");
    send("pointerdown");
    send("pointerup", { x: 60 });
    send("pointerdown", { button: 2 });
    send("pointerup", { button: 2 });
    expect(clicks).toEqual([10]);
  });

  it("leaves a press alone when asked to ignore it, and stops when told to", () => {
    const { element, send } = canvas();
    let clicks = 0;
    let ignoring = true;
    const stop = watchClicks(element, { ignore: () => ignoring, onClick: () => (clicks += 1) });
    send("pointerdown");
    send("pointerup");
    expect(clicks).toBe(0);
    ignoring = false;
    send("pointerdown");
    send("pointerup");
    expect(clicks).toBe(1);
    stop();
    send("pointerdown");
    send("pointerup");
    expect(clicks).toBe(1);
  });

  it("lets a watcher that listens first claim a click, which keeps the others from acting on it", () => {
    const { element, send } = canvas();
    const heard: string[] = [];
    // Registered second, but listening in the capture phase, so it hears the click first.
    watchClicks(element, { onClick: () => heard.push("model") });
    watchClicks(element, {
      capture: true,
      onClick: (event) => {
        heard.push("joint");
        event.preventDefault();
      },
    });
    send("pointerdown");
    send("pointerup");
    expect(heard).toEqual(["joint"]);
  });

  it("does not hold back anything else that listens for the end of the press, such as the camera controls", () => {
    const { element, send } = canvas();
    let cameraHeard = 0;
    element.addEventListener("pointerup", () => (cameraHeard += 1));
    watchClicks(element, { capture: true, onClick: (event) => event.preventDefault() });
    send("pointerdown");
    send("pointerup");
    expect(cameraHeard).toBe(1);
  });
});
