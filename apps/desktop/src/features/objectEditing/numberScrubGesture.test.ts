import { afterEach, expect, it, vi } from "vitest";
import type { PointerEvent } from "react";
import { useNumberScrub } from "./useNumberScrub";

vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }),
  useEffect: () => undefined,
}));
afterEach(() => vi.unstubAllGlobals());
function pointer(x: number) {
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- A minimal React pointer event for gesture handling.
  return {
    pointerId: 1,
    button: 0,
    clientX: x,
    shiftKey: false,
    currentTarget: { setPointerCapture: vi.fn() },
    preventDefault: vi.fn(),
  } as unknown as PointerEvent<HTMLElement>;
}
function setupWindow() {
  const target = new EventTarget();
  let callback: FrameRequestCallback | undefined;
  Object.assign(target, {
    requestAnimationFrame: (next: FrameRequestCallback) => {
      callback = next;
      return 1;
    },
    cancelAnimationFrame: () => {
      callback = undefined;
    },
  });
  vi.stubGlobal("window", target);
  return () => {
    const next = callback;
    callback = undefined;
    next?.(0);
  };
}
it("previews while the label is dragged and commits once on release", () => {
  const frame = setupWindow();
  const preview = vi.fn();
  const commit = vi.fn();
  const cancel = vi.fn();
  const scrub = useNumberScrub({
    value: 1,
    step: 0.1,
    onPreview: preview,
    onCommit: commit,
    onCancel: cancel,
  });
  scrub.onPointerDown(pointer(10));
  scrub.onPointerMove(pointer(12));
  expect(preview).not.toHaveBeenCalled();
  scrub.onPointerMove(pointer(20));
  scrub.onPointerMove(pointer(30));
  expect(preview).not.toHaveBeenCalled();
  frame();
  expect(preview).toHaveBeenCalledExactlyOnceWith(1.4);
  expect(commit).not.toHaveBeenCalled();
  scrub.onPointerMove(pointer(40));
  scrub.onPointerUp(pointer(40));
  scrub.onLostPointerCapture();
  expect(preview).toHaveBeenLastCalledWith(1.6);
  expect(commit).toHaveBeenCalledExactlyOnceWith(1.6);
  expect(cancel).not.toHaveBeenCalled();
});
it("restores the initial value when the pointer is cancelled", () => {
  const frame = setupWindow();
  const preview = vi.fn();
  const cancel = vi.fn();
  const commit = vi.fn();
  const scrub = useNumberScrub({
    value: 3,
    step: 1,
    onPreview: preview,
    onCommit: commit,
    onCancel: cancel,
  });
  scrub.onPointerDown(pointer(10));
  scrub.onPointerMove(pointer(30));
  scrub.onPointerCancel();
  frame();
  scrub.onPointerUp(pointer(30));
  expect(preview).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledExactlyOnceWith(3);
  expect(commit).not.toHaveBeenCalled();
});
it("cancels on Escape and window blur without committing", () => {
  setupWindow();
  const cancel = vi.fn();
  const commit = vi.fn();
  const scrub = useNumberScrub({
    value: 3,
    step: 1,
    onPreview: () => undefined,
    onCommit: commit,
    onCancel: cancel,
  });
  scrub.onPointerDown(pointer(10));
  scrub.onPointerMove(pointer(30));
  const escape = new Event("keydown", { cancelable: true });
  Object.assign(escape, { key: "Escape" });
  window.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(cancel).toHaveBeenCalledExactlyOnceWith(3);
  scrub.onPointerDown(pointer(10));
  scrub.onPointerMove(pointer(30));
  window.dispatchEvent(new Event("blur"));
  expect(cancel).toHaveBeenCalledTimes(2);
  expect(commit).not.toHaveBeenCalled();
});
