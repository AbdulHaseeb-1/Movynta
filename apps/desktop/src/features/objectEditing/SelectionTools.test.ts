import { afterEach, expect, it, vi } from "vitest";
import { Mesh, BoxGeometry, PerspectiveCamera, Scene } from "three";
import type { Viewport } from "@/features/viewport3d";
import { EditorScene } from "../assistant/EditorScene";
import { SelectionTools } from "./SelectionTools";
import type * as Picking from "./picking";
vi.mock("./picking", async (original) => ({
  ...(await original<typeof Picking>()),
  pickObjectId: () => undefined,
}));
afterEach(() => vi.unstubAllGlobals());
it("selects by plain drag, adds with Shift, and cleans up a cancelled drag", () => {
  const dom = new EventTarget();
  let rectangle = false;
  Object.assign(dom, {
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    setPointerCapture: () => undefined,
    hasPointerCapture: () => true,
    releasePointerCapture: () => undefined,
  });
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("HTMLElement", class HTMLElement { readonly isContentEditable = false; readonly tagName = ""; });
  vi.stubGlobal("document", {
    createElement: () => ({
      style: {},
      remove: () => {
        rectangle = false;
      },
    }),
    body: {
      appendChild: () => {
        rectangle = true;
      },
    },
  });
  const editor = new EditorScene(new Scene(), "project");
  editor.importObject("box", new Mesh(new BoxGeometry()));
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 5;
  camera.updateMatrixWorld();
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal viewport fixture; this test does not create a GPU context.
  const viewport = {
    camera,
    renderer: { domElement: dom },
  } as unknown as Viewport;
  let enabled = true;
  const selecting = new SelectionTools(viewport, editor, {
    enabled: () => enabled,
    tool: () => "select",
  });
  const pointer = (type: string, x: number, y: number, shiftKey = false) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, {
      clientX: x,
      clientY: y,
      button: 0,
      pointerId: 1,
      shiftKey,
    });
    dom.dispatchEvent(event);
  };
  pointer("pointerdown", 20, 20);
  pointer("pointermove", 80, 80);
  expect(rectangle).toBe(true);
  pointer("pointerup", 80, 80);
  expect(editor.selectedIds).toEqual(["box"]);
  expect(rectangle).toBe(false);
  pointer("pointerdown", 1, 1, true);
  pointer("pointerup", 5, 5, true);
  expect(editor.selectedIds).toEqual(["box"]);
  pointer("pointerdown", 20, 20);
  pointer("pointermove", 80, 80);
  dom.dispatchEvent(new Event("pointercancel"));
  expect(rectangle).toBe(false);
  const key = new Event("keydown", { cancelable: true });
  Object.assign(key, { key: "b", code: "KeyB", ctrlKey: false, metaKey: false, altKey: false, repeat: false });
  window.dispatchEvent(key);
  enabled = false;
  editor.select(null);
  pointer("pointerdown", 20, 20);
  pointer("pointermove", 80, 80);
  pointer("pointerup", 80, 80);
  expect(editor.selectedIds).toEqual([]);
  expect(rectangle).toBe(false);
  selecting.dispose();
});
