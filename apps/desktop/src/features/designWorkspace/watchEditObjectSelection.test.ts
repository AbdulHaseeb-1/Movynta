import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, PerspectiveCamera, Scene } from "three";
import { EditorScene } from "@/features/assistant/EditorScene";
import type { Viewport } from "@/features/viewport3d";
import { watchEditObjectSelection } from "./watchEditObjectSelection";
import { watchClicks } from "@/features/viewport3d/clicks";

function fixture() {
  const scene = new EditorScene(new Scene(), "project");
  const left = new Mesh(new BoxGeometry());
  left.position.x = -1.5;
  const right = new Group();
  const part = new Mesh(new BoxGeometry());
  right.add(part);
  right.position.x = 1.5;
  scene.importObject("left", left);
  scene.importObject("right", right);
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 10;
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  left.updateMatrixWorld(true);
  right.updateMatrixWorld(true);
  const dom = new EventTarget();
  Object.assign(dom, { getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }) });
  // The picker only needs the camera and DOM surface.
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- The fixture does not create a GPU-backed viewport.
  const viewport = { camera, renderer: { domElement: dom } } as unknown as Viewport;
  const stop = watchEditObjectSelection(viewport, scene);
  let componentClicks = 0;
  const stopComponents = watchClicks(dom, { capture: true, onClick: () => { componentClicks += 1; } });
  const click = (x: number) => {
    for (const type of ["pointerdown", "pointerup"]) {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { button: 0, clientX: x, clientY: 400 });
      dom.dispatchEvent(event);
    }
  };
  return { scene, left, right, click, stop: () => { stop(); stopComponents(); }, componentClicks: () => componentClicks };
}

describe("edit object picking", () => {
  it("switches to another object and leaves the active object alone for component selection", () => {
    const f = fixture();
    f.scene.select("left");
    f.click(545);
    expect(f.scene.selection).toBe("right");
    expect(f.componentClicks()).toBe(0);
    f.click(545);
    expect(f.scene.selection).toBe("right");
    expect(f.componentClicks()).toBe(1);
    f.click(255);
    expect(f.scene.selection).toBe("left");
    f.stop();
  });

  it("selects from an empty selection and skips hidden objects", () => {
    const f = fixture();
    f.click(545);
    expect(f.scene.selection).toBe("right");
    f.left.visible = false;
    f.click(255);
    expect(f.scene.selection).toBe("right");
    f.scene.select(null);
    f.click(545);
    expect(f.scene.selection).toBe("right");
    f.stop();
  });
});
