import { expect, it } from "vitest";
import { BoxGeometry, Mesh, Scene } from "three";
import { editorContextSchema, meshInspectionRequestSchema } from "@movynta/editor-protocol";
import { EditorScene } from "../assistant/EditorScene";
import { inspectMesh } from "./meshInspection";
import { commitStack, evaluateStack } from "./modifierStack";

it("inspects the base cage separately from the evaluated mesh without changing the modifier stack", () => {
  const mesh = new Mesh(new BoxGeometry());
  const stack = evaluateStack(mesh, [{ id: "sub", kind: "subdivision", enabled: true, levels: 1 }]);
  commitStack(mesh, stack);
  const request = { objectId: "box", meshPath: [], offset: 0, limit: 25 };
  const base = inspectMesh(mesh, { ...request, view: "base" });
  const evaluated = inspectMesh(mesh, { ...request, view: "evaluated" });
  const defaultView = inspectMesh(mesh, request);
  expect(base.view).toBe("base");
  expect(base.stats?.faces).toBe(6);
  expect(base.faces).toHaveLength(6);
  expect(evaluated.view).toBe("evaluated");
  expect(evaluated.stats?.faces).toBeGreaterThan(6);
  expect(defaultView.stats).toEqual(evaluated.stats);
  expect(mesh.geometry).toBe(stack.geometry);
  expect(base.modifiers?.[0]?.enabled).toBe(true);
  stack.base.dispose(); stack.geometry.dispose();
});

it("returns the requested base view through the editor context protocol", () => {
  const scene = new EditorScene(new Scene(), "project");
  const mesh = new Mesh(new BoxGeometry());
  commitStack(mesh, evaluateStack(mesh, [{ id: "sub", kind: "subdivision", enabled: true, levels: 1 }]));
  scene.importObject("box", mesh);
  const request = meshInspectionRequestSchema.parse({ objectId: "box", view: "base" });
  const context = editorContextSchema.parse(scene.context(request));
  expect(context.meshInspection?.view).toBe("base");
  expect(context.meshInspection?.stats?.faces).toBe(6);
  scene.reset();
});

it("finds faces by local normal and center with bounded, paginated results", () => {
  const mesh = new Mesh(new BoxGeometry(2, 2, 2));
  const request = meshInspectionRequestSchema.parse({ objectId: "box", includeSamples: false, faceQuery: { normal: [0, 1, 0], centerMin: [-2, 0, -2] } });
  const result = inspectMesh(mesh, request);
  expect(result.status).toBe("ok");
  expect(result.faces).toEqual([]);
  expect(result.vertices).toEqual([]);
  expect(result.faceMatches).toMatchObject({ total: 1, hasMore: false });
  const id = result.faceMatches?.ids[0];
  const face = id === undefined ? undefined : inspectMesh(mesh, { objectId: "box", meshPath: [], offset: Number(id), limit: 1 }).faces[0];
  expect(face?.index).toBe(Number(id));
  const page = inspectMesh(mesh, meshInspectionRequestSchema.parse({ objectId: "box", faceQuery: { centerMin: [-2, -2, -2], limit: 2, offset: 2 } }));
  expect(page.faceMatches).toMatchObject({ total: 6, offset: 2, hasMore: true });
  expect(page.faceMatches?.ids).toHaveLength(2);
  const scene = new EditorScene(new Scene(), "project");
  scene.importObject("box", mesh);
  expect(editorContextSchema.parse(scene.context(request)).meshInspection?.faceMatches).toEqual(result.faceMatches);
  scene.reset();
});
