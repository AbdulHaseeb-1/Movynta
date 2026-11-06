import { afterEach, describe, expect, it, vi } from "vitest";
import { BoxGeometry, Group, Mesh, PerspectiveCamera, Scene, Vector3 } from "three";
import type { Viewport } from "@/features/viewport3d";
import { ComponentBoxSelection } from "./ComponentBoxSelection";
import { ComponentSelection } from "./ComponentSelection";

afterEach(() => vi.unstubAllGlobals());

describe("edit mode box selection", () => {
  it("drags directly on a mesh and selects components in the box", () => {
    vi.stubGlobal("HTMLElement", class HTMLElement { readonly isContentEditable = false; readonly tagName = ""; });
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", { createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } });
    const dom = new EventTarget();
    Object.assign(dom, { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }), setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} });
    const world = new Scene();
    const root = new Group();
    const left = new Mesh(new BoxGeometry()); left.position.x = -2;
    const right = new Mesh(new BoxGeometry()); right.position.x = 2;
    root.add(left, right); world.add(root); world.updateMatrixWorld(true);
    const camera = new PerspectiveCamera(45, 1, 0.1, 100); camera.position.z = 10; camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Fixture does not create a GPU-backed viewport.
    const viewport = { scene: world, camera, renderer: { domElement: dom }, addFrameListener: () => () => {} } as unknown as Viewport;
    const selected = vi.fn<(value: { path: number[]; ids: string[] } | null) => void>();
    const switchObject = vi.fn(() => false);
    const controller = new ComponentSelection(viewport, root, "vertex", selected, () => true, switchObject);
    const corner = new Vector3(2.5, 0.5, 0.5).project(camera);
    const x = (corner.x + 1) * 400, y = (1 - corner.y) * 400;
    const pointer = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { button: 0, pointerId: 1, clientX, clientY, shiftKey: false, altKey: false });
      dom.dispatchEvent(event);
    };
    pointer("pointerdown", x - 3, y - 3);
    pointer("pointermove", x + 3, y + 3);
    pointer("pointerup", x + 3, y + 3);
    const result = selected.mock.lastCall?.[0];
    expect(result?.path).toEqual([1]);
    expect(result?.ids).toHaveLength(1);
    // Start on the mesh and drag over multiple vertices, without pressing B first.
    pointer("pointerdown", x - 70, y + 20);
    pointer("pointermove", x + 20, y + 120);
    pointer("pointerup", x + 20, y + 120);
    expect(selected.mock.lastCall?.[0]?.ids.length).toBeGreaterThan(1);
    expect(switchObject).not.toHaveBeenCalled();
    pointer("pointerdown", x, y);
    pointer("pointerup", x, y);
    expect(selected.mock.lastCall?.[0]?.path).toEqual([1]);
    expect(switchObject).toHaveBeenCalledOnce();
    controller.dispose();

  });
  it.each(["edge", "face"] as const)("box-selects %s components when the drag begins on the mesh", (kind) => {
    vi.stubGlobal("HTMLElement", class HTMLElement { readonly isContentEditable = false; readonly tagName = ""; });
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", { createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } });
    const dom = new EventTarget();
    Object.assign(dom, { style: {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }), setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} });
    const world = new Scene(), root = new Mesh(new BoxGeometry()); world.add(root); world.updateMatrixWorld(true);
    const camera = new PerspectiveCamera(45, 1, 0.1, 100); camera.position.z = 5; camera.updateMatrixWorld(true); camera.updateProjectionMatrix();
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Fixture does not create a GPU-backed viewport.
    const viewport = { scene: world, camera, renderer: { domElement: dom }, addFrameListener: () => () => {} } as unknown as Viewport;
    const selected = vi.fn<(value: { path: number[]; ids: string[] } | null) => void>();
    const controller = new ComponentSelection(viewport, root, kind, selected, () => true, () => false);
    const pointer = (type: string, clientX: number, clientY: number) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { button: 0, pointerId: 1, clientX, clientY, shiftKey: false, altKey: false });
      dom.dispatchEvent(event);
    };
    pointer("pointerdown", 400, 400); pointer("pointermove", 510, 510); pointer("pointerup", 510, 510);
    expect(selected.mock.lastCall?.[0]?.ids.length).toBeGreaterThan(0);
    controller.dispose();
  });
  it("allows B over a mesh, preserves Space-drag, and cancels an armed box", () => {
    vi.stubGlobal("HTMLElement", class HTMLElement { readonly isContentEditable = false; readonly tagName = ""; });
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", { createElement: () => ({ style: {}, remove() {} }), body: { appendChild() {} } });
    const dom = new EventTarget();
    Object.assign(dom, { style: {}, setPointerCapture() {}, hasPointerCapture: () => true, releasePointerCapture() {} });
    // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Fixture only exercises pointer handling.
    const viewport = { renderer: { domElement: dom } } as unknown as Viewport;
    const selected = vi.fn(), emptyClick = vi.fn();
    let isEmpty = false;
    const box = new ComponentBoxSelection(viewport, selected, () => false, () => isEmpty, emptyClick);
    const key = (type: string, value: string, code: string) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { key: value, code, ctrlKey: false, altKey: false, metaKey: false, repeat: false });
      window.dispatchEvent(event);
    };
    const pointer = (type: string, x: number) => {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { button: 0, pointerId: 1, clientX: x, clientY: 5, shiftKey: false, altKey: false });
      dom.dispatchEvent(event);
    };
    key("keydown", "b", "KeyB");
    pointer("pointerdown", 5); pointer("pointermove", 20); pointer("pointerup", 20);
    expect(selected).toHaveBeenCalledOnce();
    key("keydown", "b", "KeyB"); key("keydown", "Escape", "Escape");
    pointer("pointerdown", 5); pointer("pointerup", 20);
    expect(selected).toHaveBeenCalledOnce();
    isEmpty = true;
    key("keydown", " ", "Space");
    pointer("pointerdown", 5); pointer("pointerup", 20);
    key("keyup", " ", "Space");
    expect(selected).toHaveBeenCalledOnce();
    expect(emptyClick).not.toHaveBeenCalled();
    box.dispose();
  });
});
