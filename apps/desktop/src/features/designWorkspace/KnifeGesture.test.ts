import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoxGeometry, Mesh, MOUSE, PerspectiveCamera, Scene } from "three";
import type { Viewport } from "@/features/viewport3d";
import { EditorScene } from "@/features/assistant/EditorScene";
import { KnifeGesture, type KnifeCommit } from "./KnifeGesture";
import { knifeIsActive } from "./knifeActivity";
class ElementStub extends EventTarget {
  readonly style: Record<string, string> = {};
  readonly isContentEditable = false;
  readonly tagName = "CANVAS";
  readonly children: ElementStub[] = [];
  readonly attributes = new Map<string, string>();
  private capture: number | null = null;
  closest() {
    return null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  appendChild(child: ElementStub) {
    this.children.push(child);
  }
  replaceChildren() {
    this.children.splice(0);
  }
  remove() {}
  setPointerCapture(id: number) {
    this.capture = id;
  }
  hasPointerCapture(id: number) {
    return this.capture === id;
  }
  releasePointerCapture() {
    this.capture = null;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, width: 800, height: 800 };
  }
}
beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("HTMLElement", ElementStub);
  vi.stubGlobal("document", {
    createElementNS: () => new ElementStub(),
    body: new ElementStub(),
  });
});
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const world = new Scene(),
    scene = new EditorScene(world, "project"),
    mesh = new Mesh(new BoxGeometry(2, 2, 2));
  scene.importObject("box", mesh);
  scene.select("box");
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 5);
  camera.updateMatrixWorld();
  const dom = new ElementStub();
  const body = new ElementStub();
  vi.stubGlobal("document", { createElementNS: () => new ElementStub(), body });
  let frame: () => void = () => undefined;
  let enabled = true;
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal viewport fixture avoids creating a GPU context.
  const viewport = {
    scene: world,
    camera,
    renderer: { domElement: dom },
    controls: { mouseButtons: { MIDDLE: MOUSE.DOLLY } },
    addFrameListener: (callback: () => void) => {
      frame = callback;
      return () => undefined;
    },
  } as unknown as Viewport;
  const commit = vi.fn<(value: KnifeCommit) => void>(),
    report = vi.fn<(value: string) => void>(),
    status = vi.fn<(value: string) => void>(),
    active = vi.fn<(value: boolean) => void>();
  const gesture = new KnifeGesture(
    viewport,
    scene,
    () => enabled,
    () => ({ objectId: "box", meshPath: [], selectedFaces: [] }),
    commit,
    report,
    status,
    active,
  );
  const key = (value: string, ctrlKey = false, shiftKey = false) => {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, {
      key: value,
      code: value,
      ctrlKey,
      metaKey: false,
      shiftKey,
      altKey: false,
      repeat: false,
    });
    window.dispatchEvent(event);
  };
  const pointer = (type: string, x: number, y: number) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, {
      clientX: x,
      clientY: y,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      pointerId: 1,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    Object.defineProperty(event, "target", { value: dom });
    window.dispatchEvent(event);
  };
  return {
    scene,
    mesh,
    gesture,
    commit,
    report,
    status,
    active,
    key,
    pointer,
    body,
    frame: () => frame(),
    disable: () => {
      enabled = false;
    },
  };
}
describe("interactive Knife", () => {
  it("previews a cut-through stroke and emits one path while restoring the displayed source", () => {
    const f = fixture(),
      original = f.mesh.geometry;
    f.key("k");
    expect(knifeIsActive()).toBe(true);
    f.key("c");
    f.pointer("pointerdown", 100, 400);
    f.pointer("pointerup", 700, 400);
    expect(f.mesh.geometry).not.toBe(original);
    f.key("Enter");
    expect(f.commit).toHaveBeenCalledTimes(1);
    expect(f.commit.mock.calls[0]?.[0].segments.length).toBeGreaterThan(1);
    expect(f.mesh.geometry).toBe(original);
    expect(knifeIsActive()).toBe(false);
    f.gesture.dispose();
  });
  it("undoes the current stroke and cancels without committing", () => {
    const f = fixture(),
      original = f.mesh.geometry;
    f.key("k");
    f.pointer("pointerdown", 100, 400);
    f.pointer("pointerup", 700, 400);
    expect(f.mesh.geometry).not.toBe(original);
    f.key("z", true);
    expect(f.mesh.geometry).toBe(original);
    f.key("Escape");
    expect(f.commit).not.toHaveBeenCalled();
    expect(knifeIsActive()).toBe(false);
    f.gesture.dispose();
  });
  it("supports the modal control keys and ends when editing is disabled", () => {
    const f = fixture();
    f.key("k");
    f.key("a");
    f.key("4");
    f.key("5");
    expect(f.status).toHaveBeenLastCalledWith(
      expect.stringContaining("screen 45°"),
    );
    f.key("a");
    expect(f.status).toHaveBeenLastCalledWith(
      expect.stringContaining("relative"),
    );
    f.key("r");
    f.key("x");
    f.key("x");
    f.key("x");
    f.key("s");
    f.key("v");
    expect(f.status).toHaveBeenLastCalledWith(
      expect.stringContaining("X-ray off"),
    );
    f.disable();
    f.frame();
    expect(knifeIsActive()).toBe(false);
    f.gesture.dispose();
  });
  it("constrains the drawn line to global and local axes", () => {
    const f=fixture();f.mesh.rotation.z=Math.PI/4;f.key("k");
    f.pointer("pointerdown",400,400);f.pointer("pointerup",400,400);f.key("x");f.pointer("pointermove",500,440);
    const svg=f.body.children[0];const globalLine=svg?.children.find((child)=>child.attributes.has("x1"));
    expect(Number(globalLine?.attributes.get("y2"))).toBeCloseTo(400);
    f.key("x");f.pointer("pointermove",500,440);
    const localLine=svg?.children.find((child)=>child.attributes.has("x1"));
    const dx=Number(localLine?.attributes.get("x2"))-400,dy=Number(localLine?.attributes.get("y2"))-400;
    expect(dy/dx).toBeCloseTo(-1);f.key("Escape");f.gesture.dispose();
  });
  it("uses screen snapping and reports measured surface distances",()=>{
    const f=fixture();f.key("k");f.pointer("pointerdown",400,400);f.pointer("pointerup",400,400);f.key("a");f.pointer("pointermove",500,440);
    const line=f.body.children[0]?.children.find((child)=>child.attributes.has("x1"));
    const dx=Number(line?.attributes.get("x2"))-400,dy=Number(line?.attributes.get("y2"))-400;
    expect(dy/dx).toBeCloseTo(Math.tan(Math.PI/6));
    f.key("s");expect(f.status).toHaveBeenLastCalledWith(expect.stringContaining("world units"));
    window.dispatchEvent(new Event("pointercancel"));expect(knifeIsActive()).toBe(false);expect(f.commit).not.toHaveBeenCalled();f.gesture.dispose();
  });
  it("refuses selected-only mode without faces", () => {
    const f = fixture();
    f.key("k", false, true);
    expect(knifeIsActive()).toBe(false);
    expect(f.report).toHaveBeenLastCalledWith(
      expect.stringContaining("Select faces"),
    );
    f.gesture.dispose();
  });
});
