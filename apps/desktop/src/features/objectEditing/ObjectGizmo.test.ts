import { afterEach, describe, expect, it, vi } from "vitest";
import { PerspectiveCamera, Scene } from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import type { Viewport } from "@/features/viewport3d";
import { EditorScene } from "../assistant/EditorScene";
import { ObjectGizmo, type ObjectChange } from "./ObjectGizmo";

// Styling the handles reads the page's theme colors, which a test without a page does not have.
vi.mock("./handleStyle", () => ({ styleHandles: () => undefined }));
afterEach(() => vi.unstubAllGlobals());

/** A gizmo on a scene with one box that is selected, with the fakes a browser would otherwise provide. */
function setup() {
  const window = new EventTarget();
  vi.stubGlobal("window", window);
  const dom = Object.assign(new EventTarget(), {
    style: {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
  });
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.z = 5;
  camera.updateMatrixWorld();
  const scene = new Scene();
  const frames: (() => void)[] = [];
  const orbit = { enabled: true };
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal viewport fixture; this test does not create a GPU context.
  const viewport = {
    scene,
    camera,
    controls: orbit,
    renderer: { domElement: dom },
    addFrameListener: (listener: () => void) => {
      frames.push(listener);
      return () => undefined;
    },
    setOutlinedObjects: () => undefined,
  } as unknown as Viewport;
  const editor = new EditorScene(scene, "project");
  editor.execute("p1", 0, [{ commandId: "c", type: "geometry.create_primitive", objectId: "a", primitive: "box", size: 1, replaceExisting: false }]);
  editor.select("a");
  const state = { enabled: true };
  const commits: ObjectChange[][] = [];
  const gizmo = new ObjectGizmo(viewport, editor, { onLiveChange: () => undefined, onCommit: (changes) => commits.push(changes) }, {
    tool: () => "move",
    enabled: () => state.enabled,
    objectMode: () => true,
  });
  const frame = () => frames.forEach((listener) => listener());
  const controls: unknown = Reflect.get(gizmo, "controls");
  if (!(controls instanceof TransformControls)) throw new Error("The gizmo has no handles");
  frame();
  return { window, editor, gizmo, controls, orbit, state, commits, frame };
}

/** Starts a drag of the X handle and moves the box along it, as a held mouse button would. */
function dragBox(fixture: ReturnType<typeof setup>) {
  fixture.controls.axis = "X";
  fixture.controls.dragging = true;
  const box = fixture.editor.getObject("a");
  if (!box) throw new Error("The box is missing");
  box.position.x = 2;
  return box;
}

describe("a handle drag that cannot continue", () => {
  it("ends, restores the object and frees the camera when the selection is cleared during the drag", () => {
    const fixture = setup();
    const box = dragBox(fixture);
    expect(fixture.orbit.enabled).toBe(false);
    fixture.editor.select(null);
    fixture.frame();
    expect(fixture.controls.dragging).toBe(false);
    expect(fixture.orbit.enabled).toBe(true);
    expect(box.position.x).toBe(0);
    expect(fixture.commits).toEqual([]);
    fixture.gizmo.dispose();
  });

  it("ends when the handles are switched off, for example while the assistant starts working", () => {
    const fixture = setup();
    const box = dragBox(fixture);
    fixture.state.enabled = false;
    fixture.frame();
    expect(fixture.controls.dragging).toBe(false);
    expect(fixture.orbit.enabled).toBe(true);
    expect(box.position.x).toBe(0);
    fixture.gizmo.dispose();
  });

  it("is cancelled by Escape, which then leaves the selection alone", () => {
    const fixture = setup();
    const box = dragBox(fixture);
    let reachedOthers = false;
    fixture.window.addEventListener("keydown", () => (reachedOthers = true));
    const escape = Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" });
    fixture.window.dispatchEvent(escape);
    expect(fixture.controls.dragging).toBe(false);
    expect(fixture.orbit.enabled).toBe(true);
    expect(box.position.x).toBe(0);
    expect(fixture.editor.selection).toBe("a");
    expect(reachedOthers).toBe(false);
    expect(fixture.commits).toEqual([]);
    fixture.gizmo.dispose();
  });

  it("leaves Escape to the others when nothing is being dragged", () => {
    const fixture = setup();
    let reachedOthers = false;
    fixture.window.addEventListener("keydown", () => (reachedOthers = true));
    fixture.window.dispatchEvent(Object.assign(new Event("keydown", { cancelable: true }), { key: "Escape" }));
    expect(reachedOthers).toBe(true);
    fixture.gizmo.dispose();
  });
});
