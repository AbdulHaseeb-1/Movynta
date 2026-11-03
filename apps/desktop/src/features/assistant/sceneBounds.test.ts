import { expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, Scene } from "three";
import { EditorScene } from "./EditorScene";

it("reports world bounds for nested imported geometry and empty objects", () => {
  const editor = new EditorScene(new Scene(), "p");
  const parent = new Group();
  parent.position.set(10, 0, 0);
  parent.scale.set(2, 2, 2);
  const mesh = new Mesh(new BoxGeometry(2, 2, 2));
  mesh.position.set(3, 0, 0);
  parent.add(mesh);
  editor.importObject("parent", parent);
  editor.importObject("mesh", mesh);
  editor.importObject("empty", new Group());
  const objects = editor.context().objects;
  expect(objects.find(({ id }) => id === "parent")?.worldBounds).toEqual({ min: [14, -2, -2], max: [18, 2, 2] });
  expect(objects.find(({ id }) => id === "mesh")?.worldBounds).toEqual({ min: [14, -2, -2], max: [18, 2, 2] });
  expect(objects.find(({ id }) => id === "empty")?.worldBounds).toBeNull();
});

it("benchmarks bounds in snapshots with 2,000 meshes", () => {
  const editor = new EditorScene(new Scene(), "bounds-benchmark");
  const geometry = new BoxGeometry(1, 1, 1);
  for (let i = 0; i < 2000; i += 1) {
    const mesh = new Mesh(geometry);
    mesh.position.set(i, 0, 0);
    editor.importObject(`mesh_${i}`, mesh);
  }
  editor.context();
  const samples = 20;
  const start = performance.now();
  for (let i = 0; i < samples; i += 1) expect(editor.context().objects).toHaveLength(2000);
  // eslint-disable-next-line no-console -- Records the cost of the added snapshot computation.
  console.info(JSON.stringify({ objects: 2000, samples, boundsSnapshotMeanMs: (performance.now() - start) / samples }));
  geometry.dispose();
});
