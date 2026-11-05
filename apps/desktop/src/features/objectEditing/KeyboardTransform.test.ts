import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Group, Mesh, BoxGeometry, PerspectiveCamera, Scene } from "three";
import type { Viewport } from "@/features/viewport3d";
import { EditorScene } from "@/features/assistant/EditorScene";
import { KeyboardTransform } from "./KeyboardTransform";
import type { ObjectChange } from "./ObjectGizmo";

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("HTMLElement", class extends EventTarget {});
});
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const scene = new EditorScene(new Scene(), "project");
  const first = new Mesh(new BoxGeometry());
  const second = new Mesh(new BoxGeometry());
  second.position.x = 2;
  scene.importObject("a", first);
  scene.importObject("b", second);
  scene.select("a");
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const controls = { enabled: true };
  let frame: () => void = () => undefined;
  const renderer = {
    domElement: {
      getBoundingClientRect: () => ({
        width: 800,
        height: 800,
        left: 0,
        top: 0,
      }),
    },
  };
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal viewport fixture avoids creating a GPU context.
  const viewport = {
    camera,
    controls,
    renderer,
    addFrameListener: (listener: () => void) => {
      frame = listener;
      return () => undefined;
    },
  } as unknown as Viewport;
  const commits = vi.fn<(changes: ObjectChange[]) => void>();
  const status = vi.fn();
  const keyboard = new KeyboardTransform(
    viewport,
    scene,
    { enabled: () => true, tool: () => "select" },
    commits,
    status,
    () => undefined,
  );
  const key = (value: string) => {
    const e = new Event("keydown", { cancelable: true });
    Object.assign(e, {
      key: value,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      repeat: false,
    });
    window.dispatchEvent(e);
    return e;
  };
  const move = (x: number, y: number) => {
    const e = new Event("pointermove");
    Object.assign(e, { clientX: x, clientY: y });
    window.dispatchEvent(e);
  };
  const mouse = (x: number, y: number) => {
    move(x, y);
    frame();
  };
  const click = (button: number) => {
    const e = new Event("pointerdown", { cancelable: true });
    Object.assign(e, { button });
    window.dispatchEvent(e);
  };
  return {
    scene,
    first,
    second,
    controls,
    commits,
    keyboard,
    key,
    mouse,
    move,
    frame: () => frame(),
    click,
  };
}
describe("keyboard transforms", () => {
  it("accepts exact axis movement, degrees of rotation and a scale factor", () => {
    const f = fixture();
    f.key("g"); f.key("x"); f.key("-"); f.key("2");
    expect(f.first.position.x).toBeCloseTo(-2); f.key("Enter");
    expect(f.commits.mock.calls[0]?.[0][0]?.after.position[0]).toBeCloseTo(-2);
    f.key("r"); f.key("z"); f.key("9"); f.key("0");
    expect(f.first.rotation.z).toBeCloseTo(Math.PI / 2); f.key("Escape");
    f.key("s"); f.key("2"); expect(f.first.scale.x).toBeCloseTo(2);
    f.key("Enter"); expect(f.commits.mock.calls[1]?.[0][0]?.after.scale[0]).toBeCloseTo(2);
    f.keyboard.dispose();
  });
  it("blocks confirmation of incomplete numeric input", () => {
    const f = fixture(); f.key("g"); f.key("x"); f.key("-"); f.key("Enter");
    expect(f.commits).not.toHaveBeenCalled(); expect(f.controls.enabled).toBe(false);
    f.key("1"); f.key("Enter"); expect(f.commits).toHaveBeenCalledOnce(); f.keyboard.dispose();
  });
  it("restores the initial transform when the numeric entry is erased", () => {
    const f = fixture(); f.key("g"); f.key("x"); f.key("2");
    expect(f.first.position.x).toBeCloseTo(2); f.key("Backspace");
    expect(f.first.position.x).toBeCloseTo(0); f.key("Enter");
    expect(f.commits).not.toHaveBeenCalled(); f.keyboard.dispose();
  });
  it("coalesces movement until the next frame and flushes before confirmation", () => {
    const f = fixture();
    f.mouse(400, 400);
    f.key("g");
    f.move(450, 400);
    f.move(500, 400);
    expect(f.first.position.x).toBe(0);
    f.frame();
    expect(f.first.position.x).toBeGreaterThan(0);
    const first = f.first.position.x;
    f.move(600, 400);
    f.key("Enter");
    expect(f.commits.mock.calls[0]?.[0][0]?.after.position[0]).toBeGreaterThan(
      first,
    );
    f.keyboard.dispose();
  });
  it.each(["x", "y", "z"] as const)(
    "constrains move, rotate and scale to the %s axis",
    (axis) => {
      const f = fixture();
      f.mouse(600, 400);
      f.key("g");
      f.key(axis);
      f.mouse(700, 300);
      expect(Math.abs(f.first.position[axis])).toBeGreaterThan(0.01);
      for (const other of ["x", "y", "z"] as const)
        if (other !== axis) expect(f.first.position[other]).toBeCloseTo(0);
      f.key("Escape");
      f.mouse(600, 400);
      f.key("r");
      f.key(axis);
      f.mouse(400, 200);
      expect(Math.abs(f.first.rotation[axis])).toBeGreaterThan(0.1);
      f.key("Escape");
      f.mouse(600, 400);
      f.key("s");
      f.key(axis);
      f.mouse(700, 400);
      expect(f.first.scale[axis]).toBeGreaterThan(1);
      for (const other of ["x", "y", "z"] as const)
        if (other !== axis) expect(f.first.scale[other]).toBeCloseTo(1);
      f.key("Escape");
      f.keyboard.dispose();
    },
  );
  it("previews X-constrained movement, then confirms one undoable change", () => {
    const f = fixture();
    f.mouse(400, 400);
    f.key("g");
    expect(f.controls.enabled).toBe(false);
    expect(f.key("x").defaultPrevented).toBe(true);
    f.mouse(500, 440);
    expect(f.first.position.x).toBeGreaterThan(0);
    expect(f.first.position.y).toBeCloseTo(0);
    expect(f.first.position.z).toBeCloseTo(0);
    f.click(0);
    expect(f.controls.enabled).toBe(true);
    expect(f.first.position.x).toBe(0);
    expect(f.commits).toHaveBeenCalledOnce();
    expect(f.commits.mock.calls[0]?.[0][0]?.after.position[0]).toBeGreaterThan(
      0,
    );
    f.keyboard.dispose();
  });
  it("cancels with Escape or right click without saving or losing selection", () => {
    const f = fixture();
    f.mouse(450, 400);
    f.key("g");
    f.mouse(500, 420);
    f.key("Escape");
    expect(f.first.position.toArray()).toEqual([0, 0, 0]);
    expect(f.scene.selection).toBe("a");
    f.key("s");
    f.mouse(560, 400);
    expect(f.first.scale.x).toBeGreaterThan(1);
    f.click(2);
    expect(f.first.scale.x).toBe(1);
    expect(f.commits).not.toHaveBeenCalled();
    f.keyboard.dispose();
  });
  it("scales and rotates around chosen world axes for multiple selected objects", () => {
    const f = fixture();
    f.scene.selectMany(["a", "b"]);
    f.mouse(600, 400);
    f.key("s");
    f.key("x");
    f.mouse(700, 400);
    expect(f.first.scale.x).toBeGreaterThan(1);
    expect(f.first.scale.y).toBeCloseTo(1);
    expect(f.second.scale.x).toBeGreaterThan(1);
    f.key("Enter");
    expect(f.commits.mock.calls[0]?.[0]).toHaveLength(2);
    f.mouse(600, 400);
    f.key("r");
    f.key("z");
    f.mouse(400, 200);
    expect(Math.abs(f.first.rotation.z)).toBeGreaterThan(0.1);
    f.key("Escape");
    expect(f.first.rotation.z).toBeCloseTo(0);
    f.keyboard.dispose();
  });
  it("does not double-transform selected children and cancels when selection changes", () => {
    const f = fixture();
    const child = new Group();
    f.first.add(child);
    f.scene.importObject("child", child);
    f.scene.selectMany(["a", "child"]);
    f.mouse(400, 400);
    f.key("g");
    f.mouse(450, 400);
    f.key("Enter");
    expect(f.commits.mock.calls[0]?.[0]).toHaveLength(1);
    f.mouse(400, 400);
    f.key("g");
    f.mouse(450, 400);
    f.scene.select("b");
    expect(f.first.position.x).toBeCloseTo(0);
    expect(f.controls.enabled).toBe(true);
    f.keyboard.dispose();
  });
});
