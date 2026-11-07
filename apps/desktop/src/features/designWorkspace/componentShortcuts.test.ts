import { afterEach, describe, expect, it, vi } from "vitest";
import { BoxGeometry, Mesh, PerspectiveCamera, Scene } from "three";
import type { Viewport } from "@/features/viewport3d";
import { ComponentSelection } from "./ComponentSelection";

afterEach(() => vi.unstubAllGlobals());

function keyOn(target: object, key: string): Event {
  const event = new Event("keydown", { cancelable: true });
  Object.assign(event, { key, code: `Key${key.toUpperCase()}`, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false });
  Object.defineProperty(event, "target", { value: target });
  window.dispatchEvent(event);
  return event;
}

describe("edit mode keys", () => {
  function setup() {
    class FakeElement extends EventTarget {
      readonly isContentEditable = false;
      readonly tagName: string;
      private readonly inDialog: boolean;
      constructor(tagName: string, inDialog: boolean) { super(); this.tagName = tagName; this.inDialog = inDialog; }
      closest(selector: string) { return this.inDialog && selector.includes('[role="dialog"]') ? this : null; }
    }
    vi.stubGlobal("Element", FakeElement);
    vi.stubGlobal("HTMLElement", FakeElement);
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", { createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } });
    const dom = new EventTarget();
    Object.assign(dom, { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }), setPointerCapture() {}, hasPointerCapture: () => false, releasePointerCapture() {} });
    const world = new Scene(), root = new Mesh(new BoxGeometry());
    world.add(root); world.updateMatrixWorld(true);
    const camera = new PerspectiveCamera(45, 1, 0.1, 100); camera.position.z = 5; camera.updateMatrixWorld(true);
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- The fixture does not create a GPU-backed viewport.
    const viewport = { scene: world, camera, renderer: { domElement: dom }, addFrameListener: () => () => {} } as unknown as Viewport;
    const selected = vi.fn<(value: { path: number[]; ids: string[] } | null) => void>();
    const controller = new ComponentSelection(viewport, root, "face", selected, () => true, () => false);
    return { controller, selected, dialogButton: new FakeElement("BUTTON", true), body: new FakeElement("DIV", false) };
  }

  it("keeps Escape and A for a dialog that has the focus", () => {
    const { controller, selected, dialogButton } = setup();
    controller.select([], ["0"]);
    selected.mockClear();
    const escape = keyOn(dialogButton, "Escape");
    keyOn(dialogButton, "a");
    expect(selected).not.toHaveBeenCalled();
    expect(escape.defaultPrevented).toBe(false);
    controller.dispose();
  });

  it("still clears the selection with Escape and selects all with A in the viewport", () => {
    const { controller, selected, body } = setup();
    keyOn(body, "a");
    expect(selected.mock.lastCall?.[0]?.ids).toHaveLength(6);
    keyOn(body, "Escape");
    expect(selected.mock.lastCall?.[0]).toBeNull();
    controller.dispose();
  });
});
