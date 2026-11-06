import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  Matrix4,
  PerspectiveCamera,
  Vector2,
  Vector3,
} from "three";
import { createPolygonMesh } from "@/features/meshGeometry/createPolygonMesh";
import {
  readTopology,
  assertManifold,
  topology,
} from "@/features/meshGeometry/meshTopology";
import { KnifeSession } from "@/features/meshGeometry/meshKnifeSession";
import { cutKnifeStroke } from "./knifeStroke";
import { perspectiveEdgeFactor, snapKnife } from "./knifeProjection";
function camera() {
  const result = new PerspectiveCamera(60, 2, 0.1, 100);
  result.position.set(1, 0.5, 5);
  result.lookAt(1, 0.5, 0);
  result.updateMatrixWorld();
  return result;
}
function pixel(view: PerspectiveCamera, point: Vector3) {
  const p = point.clone().project(view);
  return new Vector2((p.x + 1) * 400, (1 - p.y) * 200);
}
describe("projected Knife strokes", () => {
  it("cuts across adjacent faces atomically without repeating the shared cut", () => {
    const geometry = createPolygonMesh(
        [
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 0],
          [0, 1, 0],
          [1, 1, 0],
          [2, 1, 0],
        ],
        [
          [0, 1, 4, 3],
          [1, 2, 5, 4],
        ],
      ),
      session = new KnifeSession(readTopology(geometry), geometry),
      view = camera();
    const from = pixel(view, new Vector3(-0.5, 0.5, 0)),
      to = pixel(view, new Vector3(2.5, 0.5, 0));
    expect(
      cutKnifeStroke(
        session,
        new Matrix4(),
        view,
        800,
        400,
        from,
        to,
        null,
        () => true,
      ),
    ).toBe(2);
    expect(session.mesh.faces).toHaveLength(4);
    expect(() =>
      assertManifold(session.mesh, topology(session.mesh)),
    ).not.toThrow();
    expect(
      cutKnifeStroke(
        session,
        new Matrix4(),
        view,
        800,
        400,
        from,
        to,
        null,
        () => true,
      ),
    ).toBe(0);
  });
  it("keeps both crossing cuts selected after an earlier cut edge is split", () => {
    const geometry = createPolygonMesh(
        [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
          [0, 1, 0],
        ],
        [[0, 1, 2, 3]],
      ),
      session = new KnifeSession(readTopology(geometry), geometry),
      view = camera();
    cutKnifeStroke(
      session,
      new Matrix4(),
      view,
      800,
      400,
      pixel(view, new Vector3(-0.5, 0.5, 0)),
      pixel(view, new Vector3(1.5, 0.5, 0)),
      null,
      () => true,
    );
    cutKnifeStroke(
      session,
      new Matrix4(),
      view,
      800,
      400,
      pixel(view, new Vector3(0.5, -0.5, 0)),
      pixel(view, new Vector3(0.5, 1.5, 0)),
      null,
      () => true,
    );
    expect(session.selection).toHaveLength(4);
    const graph = topology(session.mesh);
    expect(session.selection.every((id) => graph.edges.has(id))).toBe(true);
  });
  it("rejects a partly occluded face without leaving a partial cut", () => {
    const geometry = createPolygonMesh(
        [
          [0, 0, 0],
          [1, 0, 0],
          [1, 1, 0],
          [0, 1, 0],
        ],
        [[0, 1, 2, 3]],
      ),
      session = new KnifeSession(readTopology(geometry), geometry),
      view = camera();
    const from = pixel(view, new Vector3(-0.5, 0.5, 0)),
      to = pixel(view, new Vector3(1.5, 0.5, 0)),
      mid = pixel(view, new Vector3(0.5, 0.5, 0)).x;
    expect(() =>
      cutKnifeStroke(
        session,
        new Matrix4(),
        view,
        800,
        400,
        from,
        to,
        null,
        (_mesh, _face, p) => p.x < mid,
      ),
    ).toThrow("Partially occluded");
    expect(session.length).toBe(0);
  });
  it("ignores hidden snap candidates", () => {
    const mesh = {
      positions: [new Vector3(0, 0, 0), new Vector3(1, 0, 0)],
      faces: [],
    };
    const projected = [
      {
        local: mesh.positions[0] ?? new Vector3(),
        screen: new Vector2(2, 0),
        w: 1,
        depth: 0,
      },
      {
        local: mesh.positions[1] ?? new Vector3(),
        screen: new Vector2(5, 0),
        w: 1,
        depth: 0,
      },
    ];
    expect(
      snapKnife(mesh, projected, new Vector2(0, 0), false, (p) => p.x === 1).x,
    ).toBe(5);
  });
  it("honors selected-only and occlusion filters", () => {
    const geometry = createPolygonMesh(
        [
          [0, 0, 0],
          [1, 0, 0],
          [2, 0, 0],
          [0, 1, 0],
          [1, 1, 0],
          [2, 1, 0],
        ],
        [
          [0, 1, 4, 3],
          [1, 2, 5, 4],
        ],
      ),
      view = camera();
    const from = pixel(view, new Vector3(-0.5, 0.5, 0)),
      to = pixel(view, new Vector3(2.5, 0.5, 0));
    const hidden = new KnifeSession(readTopology(geometry), geometry);
    expect(
      cutKnifeStroke(
        hidden,
        new Matrix4(),
        view,
        800,
        400,
        from,
        to,
        null,
        () => false,
      ),
    ).toBe(0);
    const selected = new KnifeSession(readTopology(geometry), geometry);
    expect(
      cutKnifeStroke(
        selected,
        new Matrix4(),
        view,
        800,
        400,
        from,
        to,
        [0],
        () => true,
      ),
    ).toBe(1);
  });
  it("cuts through both sides of a closed box and retains manifold topology", () => {
    const geometry = new BoxGeometry(),
      session = new KnifeSession(readTopology(geometry), geometry),
      view = camera();
    view.position.set(0, 0, 5);
    view.lookAt(0, 0, 0);
    view.updateMatrixWorld();
    expect(
      cutKnifeStroke(
        session,
        new Matrix4(),
        view,
        800,
        400,
        pixel(view, new Vector3(-1, 0, 0)),
        pixel(view, new Vector3(1, 0, 0)),
        null,
        () => true,
      ),
    ).toBe(4);
    expect(() =>
      assertManifold(session.mesh, topology(session.mesh), true),
    ).not.toThrow();
  });
  it("converts screen midpoints to perspective-correct edge fractions", () => {
    expect(perspectiveEdgeFactor(0.5, 2, 4)).toBeCloseTo(1 / 3);
  });
});
