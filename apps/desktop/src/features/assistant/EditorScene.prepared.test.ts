import { expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, Scene } from "three";
import { EditorScene } from "./EditorScene";

it("reads a disposable proposal preview and refuses a stale revision", () => {
  const world = new Scene();
  const editor = new EditorScene(world, "p");
  const mesh = new Mesh(new BoxGeometry());
  editor.importObject("mesh", mesh);
  const commands = [{ commandId: "s", type: "geometry.subdivide", objectId: "mesh", levels: 1 }];
  const result = editor.withProposalPreview("proposal", 1, commands, (scene, candidate) => {
    expect(scene).not.toBe(world);
    expect(candidate.getObject("mesh")).not.toBe(mesh);
    return candidate.context({ objectId: "mesh", meshPath: [], offset: 0, limit: 1 }).meshInspection?.stats?.faces;
  });
  expect(result).toBe(24);
  expect(editor.getObject("mesh")).toBe(mesh);
  expect(editor.currentRevision).toBe(1);
  expect(editor.context({ objectId: "mesh", meshPath: [], offset: 0, limit: 1 }).meshInspection?.stats?.faces).toBe(6);
  expect(() => editor.withProposalPreview("proposal", 0, commands, () => null)).toThrow("Scene changed");
  expect(editor.executePrepared("proposal", 1, commands, "prepare").status).toBe("applied");
  editor.reset();
});

it("keeps prepared geometry invisible, commits once, and preserves control topology", () => {
  const editor = new EditorScene(new Scene(), "p"); const root = new Group(); const mesh = new Mesh(new BoxGeometry());
  root.add(mesh); editor.importObject("model", root);
  const input = [{ commandId: "s", type: "geometry.subdivide", objectId: "model", meshPath: [0], levels: 1 }];
  expect(editor.executePrepared("proposal", 1, input, "prepare").status).toBe("applied");
  expect(editor.currentRevision).toBe(1); expect(mesh.geometry.getAttribute("position").count).toBe(24);
  expect(editor.executePrepared("proposal", 1, input, "commit").status).toBe("applied");
  expect(editor.context({ objectId: "model", meshPath: [0], offset: 0, limit: 1 }).meshInspection?.stats?.faces).toBe(24);
  editor.executePrepared("proposal", 1, input, "commit"); expect(editor.currentRevision).toBe(2);
});

it("discards candidates without deleting or disposing displayed geometry", () => {
  const editor = new EditorScene(new Scene(), "p"); const geometry = new BoxGeometry(); const mesh = new Mesh(geometry);
  let disposed = false; geometry.addEventListener("dispose", () => { disposed = true; }); editor.importObject("mesh", mesh);
  const input = [{ commandId: "d", type: "scene.delete_object", objectId: "mesh" }];
  editor.executePrepared("proposal", 1, input, "prepare");
  expect(editor.getObject("mesh")).toBe(mesh);
  editor.executePrepared("proposal", 1, input, "discard");
  expect(editor.getObject("mesh")).toBe(mesh); expect(disposed).toBe(false); expect(editor.currentRevision).toBe(1);
});

it("benchmarks prepare and discard for a 100-object scene", () => {
  const editor = new EditorScene(new Scene(), "benchmark"); const geometry = new BoxGeometry();
  for (let i = 0; i < 100; i += 1) editor.importObject(`object_${i}`, new Mesh(geometry));
  const commands = [{ commandId: "move", type: "scene.transform_object", objectId: "object_0", transform: { position: [1, 2, 3] } }];
  const start = performance.now(); const samples = 10;
  for (let i = 0; i < samples; i += 1) {
    editor.executePrepared(`proposal_${i}`, editor.currentRevision, commands, "prepare");
    editor.executePrepared(`proposal_${i}`, editor.currentRevision, commands, "discard");
  }
  expect(editor.currentRevision).toBe(100);
  // eslint-disable-next-line no-console -- Measures the isolated-candidate overhead.
  console.info(JSON.stringify({ objects: 100, samples, prepareDiscardMeanMs: (performance.now() - start) / samples }));
});
