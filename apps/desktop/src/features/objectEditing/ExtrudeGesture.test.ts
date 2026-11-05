import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BoxGeometry,
  Mesh,
  PerspectiveCamera,
  Scene,
  type BufferGeometry,
  type Object3D,
} from "three";
import type { Viewport } from "@/features/viewport3d";
import { EditorScene } from "@/features/assistant/EditorScene";
import { assertManifold, faceNormal, readTopology, topology } from "@/features/meshGeometry/meshTopology";
import { ExtrudeGesture, type ExtrudeCommit, type FaceTransformCommit, type InsetCommit, type BevelCommit } from "./ExtrudeGesture";

beforeEach(() => {
  vi.stubGlobal("window", new EventTarget());
  vi.stubGlobal("HTMLElement", class extends EventTarget {});
});
afterEach(() => vi.unstubAllGlobals());

function fixture(editing = true, kind: "face" | "edge" = "face") {
  const scene = new EditorScene(new Scene(), "project");
  const mesh = new Mesh(new BoxGeometry(2, 2, 2));
  scene.importObject("box", mesh);
  scene.select("box");
  const cage = readTopology(mesh.geometry);
  const face = cage.faces.findIndex((item) => faceNormal(cage, item).y > 0.9);
  const edge = [...topology(cage).edges].find(([, sides]) => {
    const a = sides[0] && cage.faces[sides[0].face]; const b = sides[1] && cage.faces[sides[1].face];
    return a && b && faceNormal(cage, a).dot(faceNormal(cage, b)) < 0.5;
  })?.[0] ?? "";
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  const controls = { enabled: true };
  let frame: () => void = () => undefined;
  const viewportScene = new Scene();
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
    scene: viewportScene,
    camera,
    controls,
    renderer,
    addFrameListener: (listener: () => void) => {
      frame = listener;
      return () => undefined;
    },
  } as unknown as Viewport;
  const commits = vi.fn<(commit: ExtrudeCommit) => void>();
  const transforms = vi.fn<(commit: FaceTransformCommit) => void>();
  const insets = vi.fn<(commit: InsetCommit) => void>();
  const bevels = vi.fn<(commit: BevelCommit) => void>();
  const errors = vi.fn();
  const status = vi.fn();
  const gesture = new ExtrudeGesture(
    viewport,
    scene,
    () => true,
    () => editing,
    () => ({
      objectId: "box",
      meshPath: [],
      kind,
      ids: [kind === "face" ? String(face) : edge],
    }),
    commits,
    errors,
    status,
    transforms,
    insets,
    bevels,
  );
  const key = (value: string, ctrlKey = false) => {
    const event = new Event("keydown", { cancelable: true });
    Object.assign(event, {
      key: value,
      ctrlKey,
      metaKey: false,
      altKey: false,
      repeat: false,
    });
    window.dispatchEvent(event);
  };
  const move = (x: number, y: number) => {
    const event = new Event("pointermove");
    Object.assign(event, { clientX: x, clientY: y });
    window.dispatchEvent(event);
    frame();
  };
  return {
    scene,
    mesh,
    viewportScene,
    commits,
    transforms,
    insets,
    bevels,
    errors,
    status,
    gesture,
    key,
    move,
  };
}

describe("bevel shortcut", () => {
  it("clears the bevel preview when its typed width is erased", () => {
    const f = fixture(true, "edge"); const original = f.mesh.geometry;
    f.key("b", true); f.key("1"); expect(f.mesh.geometry).not.toBe(original);
    f.key("Backspace"); expect(f.mesh.geometry).toBe(original);
    f.key("Enter"); expect(f.bevels).not.toHaveBeenCalled(); f.gesture.dispose();
  });
  it("previews numeric width, changes segments, and commits once", () => {
    const f = fixture(true, "edge"); const original = f.mesh.geometry;
    f.key("b", true);
    for (const key of ["0", ".", "2"]) f.key(key);
    expect(f.mesh.geometry).not.toBe(original);
    const wheel = new Event("wheel", { cancelable: true }); Object.assign(wheel, { deltaY: -1 }); window.dispatchEvent(wheel);
    f.key("Enter");
    expect(f.bevels).toHaveBeenCalledOnce();
    expect(f.bevels.mock.calls[0]?.[0]).toMatchObject({ width: 0.2, segments: 4 });
    expect(f.mesh.geometry).toBe(original); f.gesture.dispose();
  });
  it("cancels the preview without committing", () => {
    const f = fixture(true, "edge"); const original = f.mesh.geometry;
    f.key("b", true); f.key("1"); f.key("Escape");
    expect(f.mesh.geometry).toBe(original); expect(f.bevels).not.toHaveBeenCalled(); f.gesture.dispose();
  });
});

describe("inset shortcut", () => {
  it("previews numeric thickness and depth and commits the selected border", () => {
    const f = fixture();
    const original = f.mesh.geometry;
    f.key("i");
    for (const key of [".", "2", "d", "-", ".", "1", "s"]) f.key(key);
    expect(f.mesh.geometry).not.toBe(original);
    expect(readTopology(f.mesh.geometry).faces).toHaveLength(10);
    f.key("Enter");
    expect(f.insets).toHaveBeenCalledOnce();
    const commit = f.insets.mock.calls[0]?.[0];
    expect(commit?.options).toMatchObject({ thickness: 0.2, depth: -0.1, selectOuter: true });
    expect(commit?.selection).toEqual(["6", "7", "8", "9"]);
    expect(f.mesh.geometry).toBe(original);
    expect(f.errors).not.toHaveBeenCalled();
    f.gesture.dispose();
  });

  it("restores the original geometry on cancel after a pointer preview", () => {
    const f = fixture();
    const original = f.mesh.geometry;
    f.move(400, 400);
    f.key("i");
    f.move(420, 400);
    expect(f.mesh.geometry).not.toBe(original);
    f.key("Escape");
    expect(f.mesh.geometry).toBe(original);
    expect(f.insets).not.toHaveBeenCalled();
    f.gesture.dispose();
  });

  it("does not confirm a previous preview while a signed number is incomplete", () => {
    const f = fixture();
    f.key("i");
    for (const key of [".", "2", "d", "-"]) f.key(key);
    f.key("Enter");
    expect(f.insets).not.toHaveBeenCalled();
    expect(f.status.mock.lastCall?.[0]).toContain("Finish entering a number");
    f.key("1");
    f.key("Enter");
    expect(f.insets.mock.calls[0]?.[0].options.depth).toBe(-1);
    f.gesture.dispose();
  });
});

/** Index of the cage face that points up, for extruding the top of the box. */
function topFaceOf(geometry: BufferGeometry): number {
  const cage = readTopology(geometry);
  return cage.faces.findIndex((face) => faceNormal(cage, face).y > 0.9);
}
/** The displayed geometry of the scene's "box". A type guard keeps the geometry typed; `instanceof` would narrow it to `any`. */
function boxGeometry(scene: EditorScene): BufferGeometry {
  const object = scene.getObject("box");
  if (!isMeshObject(object)) throw new Error("Missing box mesh");
  return object.geometry;
}
function isMeshObject(object: Object3D | undefined): object is Mesh {
  return object instanceof Mesh;
}
function highestY(geometry: BufferGeometry): number {
  const position = geometry.getAttribute("position");
  let highest = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < position.count; i += 1)
    highest = Math.max(highest, position.getY(i));
  return highest;
}

describe("extrude shortcut", () => {
  it("moves the selected-face overlay with a reused preview and removes it on cancel", () => {
    const f = fixture();
    f.move(400, 400);
    f.key("e");
    f.move(500, 430);
    const group = f.viewportScene.children[0];
    const fill = group?.children.find(isMeshObject);
    if (!fill) throw new Error("Missing preview face overlay");
    const initial = fill.geometry.getAttribute("position").getY(0);
    const geometry = f.mesh.geometry;
    f.move(550, 450);
    expect(f.mesh.geometry).toBe(geometry);
    expect(fill.geometry.getAttribute("position").getY(0)).not.toBeCloseTo(
      initial,
    );
    f.key("Escape");
    expect(f.viewportScene.children).toHaveLength(0);
    f.gesture.dispose();
  });
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
    expect(
      f.commits.mock.calls[0]?.[0].offset.some(
        (value) => Math.abs(value) > 1e-6,
      ),
    ).toBe(true);
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

  it("keeps the last valid preview while blocked and requires a valid pointer before confirming", () => {
    const f = fixture();
    f.move(400, 400);
    f.key("e");
    f.key("x");
    f.key("x");
    f.move(500, 430);
    const valid = f.mesh.geometry;
    expect(valid.getAttribute("position").count).not.toBe(24);
    // Straight across the screen runs along the top face's x edges, so that offset is blocked.
    f.move(500, 400);
    expect(f.status).toHaveBeenLastCalledWith(
      expect.stringContaining("no area"),
    );
    expect(f.mesh.geometry).toBe(valid);
    f.key("Enter");
    expect(f.errors).not.toHaveBeenCalled();
    expect(f.commits).not.toHaveBeenCalled();
    f.move(500, 430);
    f.key("Enter");
    expect(f.commits).toHaveBeenCalledOnce();
    expect(f.commits.mock.calls[0]?.[0].offset[1]).not.toBe(0);
    f.gesture.dispose();
  });

  it("moves selected faces without extrusion and saves the same cage", () => {
    const f = fixture();
    f.move(400, 400);
    f.key("g");
    f.key("y");
    f.move(400, 350);
    const rendered = f.mesh.geometry;
    f.move(400, 325);
    expect(f.mesh.geometry).toBe(rendered);
    const previewPositions = Array.from(rendered.getAttribute("position").array);
    const preview = readTopology(rendered);
    expect(preview.faces).toHaveLength(6);
    expect(highestY(f.mesh.geometry)).toBeGreaterThan(1);
    f.key("Enter");
    const commit = f.transforms.mock.calls[0]?.[0];
    if (!commit) throw new Error("Missing face move");
    expect(f.scene.execute("move", commit.revision, [{
      commandId: "move", type: "geometry.transform_faces", objectId: commit.objectId,
      meshPath: commit.meshPath, ids: commit.ids, space: "world", transform: commit.transform,
    }]).status).toBe("applied");
    expect(Array.from(f.mesh.geometry.getAttribute("position").array)).toEqual(previewPositions);
    expect(f.commits).not.toHaveBeenCalled();
    f.gesture.dispose();
  });

  it("scales then tilts the cap and commits both controls", () => {
    const f = fixture();
    f.move(400, 400);
    f.key("e");
    f.move(500, 350);
    f.key("s");
    f.move(460, 350);
    f.key("r");
    f.key("x");
    f.move(480, 350);
    const preview = Array.from(f.mesh.geometry.getAttribute("position").array);
    const previewUvs = Array.from(f.mesh.geometry.getAttribute("uv").array);
    f.key("Enter");
    const commit = f.commits.mock.calls[0]?.[0];
    if (!commit) throw new Error("Missing shaped extrusion");
    expect(commit.shape?.capScale).toBeLessThan(1);
    expect(commit.shape?.capRotationDegrees?.[0]).toBeCloseTo(10);
    expect(f.scene.execute("shape", commit.revision, [{
      commandId: "shape", type: "geometry.extrude", kind: "face", objectId: commit.objectId,
      ids: commit.ids, offset: commit.offset, ...commit.shape,
    }]).status).toBe("applied");
    expect(Array.from(f.mesh.geometry.getAttribute("position").array)).toEqual(preview);
    expect(Array.from(f.mesh.geometry.getAttribute("uv").array)).toEqual(previewUvs);
    f.gesture.dispose();
  });

  it("repeats extrusion on the returned cap and then moves it in one component batch", () => {
    const f = fixture();
    const id = String(topFaceOf(f.mesh.geometry));
    const result = f.scene.execute("repeat", f.scene.currentRevision, [
      { commandId: "repeat", type: "geometry.extrude", objectId: "box", kind: "face", ids: [id], normalDistance: 1, steps: 3 },
      { commandId: "shift", type: "geometry.transform_faces", objectId: "box", ids: [id], transform: { position: [0, 0.5, 0] } },
    ]);
    expect("message" in result ? result.message : undefined).toBeUndefined();
    expect(result.status).toBe("applied");
    const cage = readTopology(f.mesh.geometry);
    expect(cage.faces).toHaveLength(18);
    expect(highestY(f.mesh.geometry)).toBeCloseTo(4.5);
    expect(() => assertManifold(cage, topology(cage), true)).not.toThrow();
    f.gesture.dispose();
  });

  it.each(["normals", "individual"] as const)("previews and commits the %s mode from the edit menu", (mode) => {
    const f = fixture();
    f.move(400, 400);
    f.gesture.start(mode);
    f.move(400, 350);
    const preview = readTopology(f.mesh.geometry);
    f.key("Enter");
    const commit = f.commits.mock.calls[0]?.[0];
    if (!commit) throw new Error("Missing normal extrusion");
    expect(commit.normalMode).toBe(mode === "normals" ? "vertex" : "individual");
    const result = f.scene.execute("normal", commit.revision, [{
      commandId: "normal", type: "geometry.extrude", objectId: "box", kind: "face",
      ids: commit.ids, normalDistance: commit.normalDistance, normalMode: commit.normalMode,
    }]);
    expect(result.status).toBe("applied");
    expect(readTopology(f.mesh.geometry).positions).toEqual(preview.positions);
    f.gesture.dispose();
  });

  it("ends the grab before another edit runs, so that edit builds on the committed cage", () => {
    const f = fixture();
    const committed = f.mesh.geometry;
    const top = topFaceOf(committed);
    f.move(400, 400);
    f.key("e");
    f.move(500, 430);
    expect(f.mesh.geometry).not.toBe(committed);
    const applied = f.scene.execute("extrude", f.scene.currentRevision, [
      {
        commandId: "other",
        type: "geometry.extrude",
        objectId: "box",
        kind: "face",
        ids: [String(top)],
        offset: [0, 1, 0],
      },
    ]);
    expect(applied.status).toBe("applied");
    expect(f.commits).not.toHaveBeenCalled();
    // The committed top face rises from y=1 to y=2. Built on the preview, the cap would sit higher.
    expect(highestY(f.mesh.geometry)).toBeCloseTo(2);
    f.gesture.dispose();
  });

  it("ends the grab before a prepared change forks the scene, so the prepared change builds on the committed cage", () => {
    const f = fixture();
    const top = topFaceOf(f.mesh.geometry);
    f.move(400, 400);
    f.key("e");
    f.move(500, 430);
    const revision = f.scene.currentRevision;
    const commands = [
      {
        commandId: "prepared",
        type: "geometry.extrude",
        objectId: "box",
        kind: "face",
        ids: [String(top)],
        offset: [0, 1, 0],
      },
    ];
    expect(
      f.scene.executePrepared(
        "prepared-proposal",
        revision,
        commands,
        "prepare",
      ).status,
    ).toBe("applied");
    expect(f.commits).not.toHaveBeenCalled();
    expect(
      f.scene.executePrepared("prepared-proposal", revision, commands, "commit")
        .status,
    ).toBe("applied");
    expect(highestY(boxGeometry(f.scene))).toBeCloseTo(2);
    f.gesture.dispose();
  });

  it("ends the grab before an inspection names components, so the ids refer to the committed cage", () => {
    const f = fixture();
    const committed = f.mesh.geometry;
    f.move(400, 400);
    f.key("e");
    f.move(500, 430);
    expect(f.mesh.geometry).not.toBe(committed);
    f.scene.context({ objectId: "box", meshPath: [], offset: 0, limit: 25 });
    expect(f.commits).not.toHaveBeenCalled();
    expect(f.status).toHaveBeenLastCalledWith("");
    expect(f.mesh.geometry).toBe(committed);
    f.gesture.dispose();
  });

  it("toggles a world axis with X and clears it on the second press", () => {
    const f = fixture();
    f.move(400, 400);
    f.key("e");
    f.key("x");
    expect(f.status).toHaveBeenLastCalledWith(expect.stringContaining("· X"));
    f.key("x");
    expect(f.status.mock.lastCall?.[0]).not.toContain("Extrude · X");
    f.gesture.dispose();
  });
});
