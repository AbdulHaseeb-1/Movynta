import { expect, it } from "vitest";
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  SphereGeometry,
  TorusGeometry,
  Vector2,
} from "three";
import {
  componentGeometry,
  faceHighlightPositions,
  pickComponent,
} from "./componentGeometry";

it("selects whole cube faces, vertices and edges without selecting triangulation diagonals", () => {
  const data = componentGeometry(new BoxGeometry(2, 2, 2));
  expect(data.mesh.faces).toHaveLength(6);
  expect(data.edges.size).toBe(12);
  const camera = new PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.z = 5;
  camera.updateMatrixWorld();
  const ray = new Raycaster();
  ray.setFromCamera(new Vector2(0, 0), camera);
  const proxy = new Mesh(
    data.picking,
    new MeshBasicMaterial({ side: DoubleSide }),
  );
  const hit = ray.intersectObject(proxy)[0];
  const triangle = hit?.faceIndex;
  expect(triangle).toBeTypeOf("number");
  if (triangle === undefined || triangle === null)
    throw new Error("Missing face");
  const faceId = Number(
    pickComponent(
      data,
      triangle,
      "face",
      new Vector2(),
      new Matrix4(),
      camera,
      800,
      800,
    ),
  );
  const face = data.mesh.faces[faceId];
  if (!face) throw new Error("Missing polygon");
  const a = face[0];
  const b = face[1];
  if (a === undefined || b === undefined) throw new Error("Missing vertices");
  const vertex = data.mesh.positions[a];
  const next = data.mesh.positions[b];
  if (!vertex || !next) throw new Error("Missing points");
  const projected = vertex.clone().project(camera);
  expect(
    pickComponent(
      data,
      triangle,
      "vertex",
      new Vector2(projected.x, projected.y),
      new Matrix4(),
      camera,
      800,
      800,
    ),
  ).toBe(String(a));
  const midpoint = vertex.clone().add(next).multiplyScalar(0.5).project(camera);
  expect(
    pickComponent(
      data,
      triangle,
      "edge",
      new Vector2(midpoint.x, midpoint.y),
      new Matrix4(),
      camera,
      800,
      800,
    ),
  ).toBeDefined();
  expect(
    pickComponent(
      data,
      triangle,
      "vertex",
      new Vector2(),
      new Matrix4(),
      camera,
      800,
      800,
    ),
  ).toBeUndefined();
  data.picking.dispose();
  proxy.material.dispose();
});
it("collects the exact triangles of each selected face in selection order", () => {
  const source = new BoxGeometry(2, 2, 2);
  const data = componentGeometry(source);
  const attr = data.picking.getAttribute("position");
  const expected: number[] = [];
  for (const face of [4, 1, 4])
    data.triangleFaces.forEach((id, triangle) => {
      if (id === face)
        for (let corner = 0; corner < 3; corner++) {
          const vertex = triangle * 3 + corner;
          expected.push(
            attr.getX(vertex),
            attr.getY(vertex),
            attr.getZ(vertex),
          );
        }
    });
  expect(faceHighlightPositions(data, ["4", "1", "4", "999", "-1"])).toEqual(
    expected,
  );
  expect(faceHighlightPositions(data, [])).toEqual([]);
  data.picking.dispose();
  source.dispose();
});
it("reuses unchanged topology while keeping picking buffers independent, and invalidates after geometry edits", () => {
  const source = new BoxGeometry(2, 2, 2);
  const first = componentGeometry(source);
  const second = componentGeometry(source);
  expect(second.mesh).toBe(first.mesh);
  expect(second.triangleFaces).toBe(first.triangleFaces);
  const a = first.picking.getAttribute("position");
  const b = second.picking.getAttribute("position");
  const original = b.getX(0);
  a.setX(0, original + 5);
  expect(b.getX(0)).toBe(original);
  first.picking.dispose();
  expect(b.getX(0)).toBe(original);
  const position = source.getAttribute("position");
  position.setX(0, position.getX(0) + 0.25);
  position.needsUpdate = true;
  const changed = componentGeometry(source);
  expect(changed.mesh).not.toBe(first.mesh);
  expect(changed.triangleFaces).not.toBe(first.triangleFaces);
  second.picking.dispose();
  changed.picking.dispose();
  source.dispose();
});
it("builds component geometry for every Add menu shape within an interactive budget", () => {
  const shapes = [
    new BoxGeometry(2, 2, 2),
    new SphereGeometry(1, 24, 16),
    new CylinderGeometry(1, 1, 2, 24),
    new ConeGeometry(1, 2, 24),
    new TorusGeometry(0.7, 0.3, 12, 32),
    new PlaneGeometry(2, 2),
  ];
  const start = performance.now();
  for (const shape of shapes) {
    const data = componentGeometry(shape);
    expect(data.mesh.positions.length).toBeGreaterThan(0);
    expect(data.triangleFaces.length).toBeGreaterThan(0);
    expect(data.edges.size).toBeGreaterThan(0);
    data.picking.dispose();
    shape.dispose();
  }
  // eslint-disable-next-line no-console -- Records the six-shape topology preparation benchmark.
  console.info(`Six shapes: ${(performance.now() - start).toFixed(1)} ms`);
});
