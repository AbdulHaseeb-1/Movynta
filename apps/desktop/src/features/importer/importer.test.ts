import { describe, expect, it } from "vitest";
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  type Object3D,
} from "three";
import { EditorScene } from "../assistant/EditorScene";
import {
  formatFileSize,
  MODEL_FILE_ACCEPT,
  modelFormatOf,
  unsupportedFileMessage,
} from "./modelFormats";
import { makeObjectId } from "./objectId";
import { parseModel } from "./parseModel";
import { prepareModel, scaleNotice } from "./prepareModel";

const encode = (text: string) => new TextEncoder().encode(text).buffer;
const sized = (x: number, y: number, z: number, at = new Vector3()) => {
  const mesh = new Mesh(new BoxGeometry(x, y, z), new MeshStandardMaterial());
  mesh.position.copy(at);
  return mesh;
};
const bounds = (object: Object3D) => {
  object.updateMatrixWorld(true);
  return new Box3().setFromObject(object);
};
const countMeshes = (root: Object3D) => {
  let count = 0;
  root.traverse((node) => {
    if (node instanceof Mesh) count += 1;
  });
  return count;
};

describe("model formats", () => {
  it("recognizes formats by extension, whatever the case", () => {
    expect(modelFormatOf("Robot.GLB")).toBe("glb");
    expect(modelFormatOf("scene.v2.gltf")).toBe("gltf");
    expect(modelFormatOf("part.stl")).toBe("stl");
    expect(modelFormatOf("notes.txt")).toBeUndefined();
    expect(modelFormatOf("noextension")).toBeUndefined();
    expect(MODEL_FILE_ACCEPT).toBe(".glb,.gltf,.obj,.fbx,.stl,.ply,.dae");
  });

  it("tells Blender users how to get a file the app can open", () => {
    expect(unsupportedFileMessage("character.blend")).toContain("File → Export → glTF 2.0");
    expect(unsupportedFileMessage("movie.mp4")).toContain(".mp4 files cannot be imported");
  });

  it("formats sizes for people", () => {
    expect(formatFileSize(100)).toBe("1 KB");
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
  });
});

describe("makeObjectId", () => {
  it("builds a valid id from the file name", () => {
    const id = makeObjectId("My Robot (v2).glb", new Set(), () => "ab12");
    expect(id).toBe("My_Robot_v2_ab12");
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  });

  it("falls back for names with nothing usable, limits length and avoids taken ids", () => {
    expect(makeObjectId("日本語.fbx", new Set(), () => "0001")).toBe("model_0001");
    expect(makeObjectId(`${"x".repeat(100)}.obj`, new Set(), () => "0001").length).toBeLessThanOrEqual(64);
    const suffixes = ["same", "same", "next"];
    expect(makeObjectId("a.glb", new Set(["a_same"]), () => suffixes.shift() ?? "z")).toBe("a_next");
  });
});

describe("parseModel", () => {
  it("reads an OBJ file", async () => {
    const object = await parseModel("obj", encode("o tri\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n"));
    expect(bounds(object).getSize(new Vector3()).x).toBeCloseTo(1);
  });

  it("reads an ASCII STL file into a mesh with a material", async () => {
    const stl =
      "solid t\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 2 0 0\nvertex 0 2 0\nendloop\nendfacet\nendsolid t\n";
    const object = await parseModel("stl", encode(stl));
    expect(object).toBeInstanceOf(Mesh);
    expect(bounds(object).getSize(new Vector3()).y).toBeCloseTo(2);
  });

  it("reads a binary glTF (GLB) file", async () => {
    // One triangle: a JSON chunk describing it, and a binary chunk holding its three vertices.
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const json = JSON.stringify({
      asset: { version: "2.0" },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] },
      ],
      bufferViews: [{ buffer: 0, byteLength: 36 }],
      buffers: [{ byteLength: 36 }],
    });
    const jsonBytes = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, " "));
    const glb = new Uint8Array(12 + 8 + jsonBytes.length + 8 + positions.byteLength);
    const view = new DataView(glb.buffer);
    view.setUint32(0, 0x46546c67, true); // "glTF"
    view.setUint32(4, 2, true);
    view.setUint32(8, glb.length, true);
    view.setUint32(12, jsonBytes.length, true);
    view.setUint32(16, 0x4e4f534a, true); // "JSON"
    glb.set(jsonBytes, 20);
    const binaryAt = 20 + jsonBytes.length;
    view.setUint32(binaryAt, positions.byteLength, true);
    view.setUint32(binaryAt + 4, 0x004e4942, true); // "BIN"
    glb.set(new Uint8Array(positions.buffer), binaryAt + 8);
    const object = await parseModel("glb", glb.buffer);
    expect(bounds(object).getSize(new Vector3()).x).toBeCloseTo(1);
  });

  it("fails with an error, not a crash, on a damaged file", async () => {
    await expect(parseModel("gltf", encode("{ not json"))).rejects.toThrow();
  });
});

describe("prepareModel", () => {
  it("drops the lights and cameras that came with the file", () => {
    const content = new Group();
    content.add(sized(1, 1, 1), new AmbientLight(), new PerspectiveCamera());
    const { object } = prepareModel(content, "scene.glb");
    let extras = 0;
    object.traverse((node) => {
      if ("isLight" in node || "isCamera" in node) extras += 1;
    });
    expect(extras).toBe(0);
    expect(object.name).toBe("scene.glb");
  });

  it("stands the model on the ground, centered, without moving its outer object", () => {
    const { object } = prepareModel(sized(2, 4, 2, new Vector3(10, 30, -5)), "box");
    const box = bounds(object);
    expect(box.min.y).toBeCloseTo(0);
    expect(box.getCenter(new Vector3()).x).toBeCloseTo(0);
    expect(box.getCenter(new Vector3()).z).toBeCloseTo(0);
    expect(object.position.toArray()).toEqual([0, 0, 0]);
    expect(object.scale.toArray()).toEqual([1, 1, 1]);
  });

  it("keeps a reasonable size as it is and rescales extreme ones", () => {
    expect(bounds(prepareModel(sized(3, 3, 3), "ok").object).getSize(new Vector3()).x).toBeCloseTo(3);
    expect(bounds(prepareModel(sized(500, 500, 500), "huge").object).getSize(new Vector3()).x).toBeCloseTo(2);
    expect(bounds(prepareModel(sized(0.01, 0.01, 0.01), "tiny").object).getSize(new Vector3()).x).toBeCloseTo(2);
  });

  it("reports how much a model was resized, so its real size can be recovered", () => {
    const kept = prepareModel(sized(3, 3, 3), "ok");
    expect(kept.scaleFactor).toBe(1);
    expect(scaleNotice("ok.glb", kept.scaleFactor, kept.originalSize)).toBeUndefined();
    const huge = prepareModel(sized(500, 250, 100), "huge");
    expect(huge.scaleFactor).toBeCloseTo(2 / 500);
    expect(huge.originalSize).toBeCloseTo(500);
    expect(scaleNotice("huge.glb", huge.scaleFactor, huge.originalSize)).toContain("500 → 2 units");
  });

  it("counts triangles and rejects files with nothing to show", () => {
    expect(prepareModel(sized(1, 1, 1), "box").triangles).toBe(12);
    expect(() => prepareModel(new Group(), "empty")).toThrow("does not contain any 3D geometry");
  });
});

describe("imported models in the scene", () => {
  function model() {
    const content = new Group();
    content.add(sized(1, 1, 1), sized(1, 1, 1, new Vector3(2, 0, 0)));
    return prepareModel(content, "pair.glb").object;
  }
  const box = {
    commandId: "b",
    type: "geometry.create_primitive",
    objectId: "cube",
    primitive: "box",
    size: 1,
    replaceExisting: false,
  };

  it("shows up for the assistant as one object and moves the scene to a new revision", () => {
    const editor = new EditorScene(new Scene(), "prj_1");
    editor.importObject("pair_ab12", model());
    const context = editor.context();
    expect(context.revision).toBe(1);
    expect(context.objects).toMatchObject([{ id: "pair_ab12", name: "pair.glb", type: "empty", parentId: null }]);
    expect(editor.objectIds().has("pair_ab12")).toBe(true);
    expect(() => editor.importObject("pair_ab12", model())).toThrow("already exists");
  });

  it("keeps the inner parts of a model through later batches, which clone the scene", () => {
    const scene = new Scene();
    const editor = new EditorScene(scene, "prj_1");
    editor.importObject("pair", model());
    expect(countMeshes(scene)).toBe(2);
    const move = {
      commandId: "m1",
      type: "scene.transform_object",
      objectId: "pair",
      transform: { position: [3, 0, 0] },
    };
    expect(editor.execute("p1", 1, [move]).status).toBe("applied");
    expect(editor.execute("p2", 2, [box]).status).toBe("applied");
    expect(countMeshes(scene)).toBe(3);
    expect(editor.context().objects.find((object) => object.id === "pair")?.transform.position).toEqual([3, 0, 0]);
  });

  it("removes the whole model when the assistant deletes it, and loses nothing if a batch fails", () => {
    const scene = new Scene();
    const editor = new EditorScene(scene, "prj_1");
    editor.importObject("pair", model());
    const failing = [
      { commandId: "ok", type: "scene.delete_object", objectId: "pair" },
      { commandId: "bad", type: "scene.delete_object", objectId: "ghost" },
    ];
    expect(editor.execute("p1", 1, failing).status).toBe("failed");
    expect(countMeshes(scene)).toBe(2);
    const remove = [{ commandId: "del", type: "scene.delete_object", objectId: "pair" }];
    expect(editor.execute("p2", 1, remove).status).toBe("applied");
    expect(countMeshes(scene)).toBe(0);
  });

  it("restores imports and commands in the order they happened", async () => {
    const editor = new EditorScene(new Scene(), "prj_1");
    const loaded: string[] = [];
    const move = {
      commandId: "m",
      type: "scene.transform_object",
      objectId: "pair",
      transform: { position: [1, 0, 0] },
    };
    await editor.restore(
      [
        { kind: "commands", proposalId: "p1", commands: [box] },
        { kind: "import", assetId: "ast_1", objectId: "pair", name: "pair.glb", format: "glb" },
        { kind: "commands", proposalId: "p2", commands: [move] },
      ],
      (step) => {
        loaded.push(step.assetId);
        return Promise.resolve(model());
      },
    );
    expect(loaded).toEqual(["ast_1"]);
    expect(editor.context().revision).toBe(3);
    expect(editor.context().objects.map((object) => object.id)).toEqual(["cube", "pair"]);
  });

  it("can be emptied to start a restore again", () => {
    const editor = new EditorScene(new Scene(), "prj_1");
    editor.importObject("pair", model());
    editor.reset();
    expect(editor.context()).toMatchObject({ revision: 0, objects: [] });
    editor.importObject("pair", model());
    expect(editor.context().objects).toHaveLength(1);
  });
});
