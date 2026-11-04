import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoxGeometry, Mesh, PerspectiveCamera, Scene } from "three";
import type { Viewport } from "@/features/viewport3d";
import { EditorScene } from "@/features/assistant/EditorScene";
import { faceNormal, readTopology } from "@/features/meshGeometry/meshTopology";
import { ExtrudeGesture, type ExtrudeCommit } from "./ExtrudeGesture";

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("HTMLElement", class extends EventTarget {});
});
afterEach(() => vi.unstubAllGlobals());

function fixture(editing = true) {
  const scene = new EditorScene(new Scene(), "project");
  const mesh = new Mesh(new BoxGeometry(2, 2, 2));
  scene.importObject("box", mesh);
  scene.select("box");
  const cage = readTopology(mesh.geometry);
  const face = cage.faces.findIndex((item) => faceNormal(cage, item).y > 0.9);
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const controls = { enabled: true };
  let frame: () => void = () => undefined;
  const renderer = { domElement: { getBoundingClientRect: () => ({ width: 800, height: 800, left: 0, top: 0 }) } };
  // eslint-disable-next-line typescript/no-unsafe-type-assertion -- Minimal viewport fixture avoids creating a GPU context.
  const viewport = { camera, controls, renderer, addFrameListener: (listener: () => void) => { frame = listener; return () => undefined; } } as unknown as Viewport;
  const commits = vi.fn<(commit: ExtrudeCommit) => void>();
  const errors = vi.fn();
  const status = vi.fn();
  const gesture = new ExtrudeGesture(viewport, scene, () => true, () => editing, () => ({ objectId: "box", meshPath: [], kind: "face", ids: [String(face)] }), commits, errors, status);
  const key = (value: string) => {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, { key: value, ctrlKey: false, metaKey: false, altKey: false, repeat: false });
    window.dispatchEvent(event);
  };
  const move = (x: number, y: number) => {
    const event = new Event("pointermove");
    Object.assign(event, { clientX: x, clientY: y });
    window.dispatchEvent(event);
    frame();
  };
  return { scene, mesh, commits, errors, status, gesture, key, move };
}

describe("extrude shortcut", () => {
  it("starts a grab from E and confirms the offset", () => {
    const f = fixture();
    f.move(400, 400);
    const revision = f.scene.currentRevision;
    f.key("e");
    expect(f.status).toHaveBeenCalledWith(expect.stringContaining("Extrude"));
    // Diagonal: a purely horizontal grab would run along the top face's x edges and have no wall area.
    f.move(500, 430);
    f.key("Enter");
    expect(f.commits).toHaveBeenCalledOnce();
    expect(f.commits.mock.calls[0]?.[0].offset.some((value) => Math.abs(value) > 1e-6)).toBe(true);
    expect(f.commits.mock.calls[0]?.[0].revision).toBe(revision);
    expect(f.mesh.geometry.getAttribute("position").count).toBe(24);
    f.gesture.dispose();
  });

  it("cancels with Escape and does nothing in object mode", () => {
    const editing = fixture();
    editing.move(400, 400);
    editing.key("e");
    editing.move(520, 400);
    editing.key("Escape");
    expect(editing.commits).not.toHaveBeenCalled();
    expect(editing.mesh.geometry.getAttribute("position").count).toBe(24);
    editing.gesture.dispose();
    const objects = fixture(false);
    objects.key("e");
    expect(objects.commits).not.toHaveBeenCalled();
    expect(objects.errors).not.toHaveBeenCalled();
    objects.gesture.dispose();
  });

  it("keeps the last valid preview while the pointer runs along an edge, and confirms that preview", () => {
    const f = fixture();
    f.move(400, 400);
    f.key("e");
    f.move(500, 430);
    const valid = f.mesh.geometry;
    expect(valid.getAttribute("position").count).not.toBe(24);
    // Straight across the screen runs along the top face's x edges, so that offset is blocked.
    f.move(500, 400);
    expect(f.status).toHaveBeenLastCalledWith(expect.stringContaining("no area"));
    expect(f.mesh.geometry).toBe(valid);
    f.key("Enter");
    expect(f.errors).not.toHaveBeenCalled();
    expect(f.commits).toHaveBeenCalledOnce();
    expect(f.commits.mock.calls[0]?.[0].offset[1]).not.toBe(0);
    f.gesture.dispose();
  });

  it("keeps an edit that lands during the grab when the grab is cancelled", () => {
    const f = fixture();
    f.move(400, 400);
    f.key("e");
    f.move(500, 430);
    expect(f.mesh.geometry.getAttribute("position").count).not.toBe(24);
    // Another edit replaces the object's geometry while the preview is on screen. Extrude the top face, which is perpendicular to y.
    const cage = readTopology(f.mesh.geometry);
    const top = cage.faces.findIndex((face) => faceNormal(cage, face).y > 0.9);
    const applied = f.scene.execute("extrude", f.scene.currentRevision, [{ commandId: "other", type: "geometry.extrude", objectId: "box", kind: "face", ids: [String(top)], offset: [0, 1, 0] }]);
    expect(applied.status).toBe("applied");
    const replaced = f.mesh.geometry;
    expect(replaced.getAttribute("position").count).not.toBe(24);
    f.key("Escape");
    expect(f.commits).not.toHaveBeenCalled();
    expect(f.mesh.geometry).toBe(replaced);
    f.gesture.dispose();
  });

  it("toggles a world axis with X and clears it on the second press", () => {
    const f = fixture();
    f.move(400, 400);
    f.key("e");
    f.key("x");
    expect(f.status).toHaveBeenLastCalledWith(expect.stringContaining("· X"));
    f.key("x");
    expect(f.status.mock.lastCall?.[0]).not.toContain("· X");
    f.gesture.dispose();
  });
});
