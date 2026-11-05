import { describe, expect, it } from "vitest";
import { BoxGeometry, Group, Mesh, Scene, Triangle, Vector3 } from "three";
import { EditorScene } from "./EditorScene";
import { closestSurface } from "@/features/meshGeometry/surfaceDistance";
import { readTopology, topology } from "@/features/meshGeometry/meshTopology";

describe("measurements", () => {
  it("measures transformed vertices in world and local axes including descendants", () => {
    const scene = new EditorScene(new Scene(), "p");
    const root = new Group();
    root.scale.set(2, 3, 1);
    const mesh = new Mesh(new BoxGeometry(2, 2, 2));
    mesh.position.x = 4;
    root.add(mesh);
    scene.importObject("model", root);
    const world = scene.measure({ kind: "dimensions", target: { objectId: "model" } });
    const local = scene.measure({ kind: "dimensions", target: { objectId: "model" }, space: "local" });
    expect(world).toMatchObject({ status: "ok", data: { size: [4, 6, 2], center: [8, 0, 0] } });
    expect(local).toMatchObject({ status: "ok", data: { size: [2, 2, 2], center: [4, 0, 0] } });
  });

  it("measures lengths, angles and rejects stale component references", () => {
    const scene = new EditorScene(new Scene(), "p");
    const geometry = new BoxGeometry(2, 2, 2);
    scene.importObject("box", new Mesh(geometry));
    const edge = topology(readTopology(geometry)).edges.keys().next().value;
    if (!edge) throw new Error("Missing test edge");
    expect(scene.measure({ kind: "edge", objectId: "box", edge, revision: scene.currentRevision })).toMatchObject({ status: "ok", data: { length: 2 } });
    expect(scene.measure({ kind: "distance", from: [0, 0, 0], to: [3, 4, 0] })).toMatchObject({ status: "ok", data: { length: 5 } });
    expect(scene.measure({ kind: "angle", from: [1, 0, 0], at: [0, 0, 0], to: [0, 1, 0] })).toMatchObject({ status: "ok", data: { degrees: 90 } });
    expect(scene.measure({ kind: "distance", from: { objectId: "box", vertex: 0, revision: 999 }, to: [0, 0, 0] }).status).toBe("unavailable");
    expect(scene.measure({ kind: "angle", from: [0, 0, 0], at: [0, 0, 0], to: [0, 1, 0] }).status).toBe("unavailable");
  });

  it("verifies placement above another object through commands and remeasurement", () => {
    const scene = new EditorScene(new Scene(), "p");
    scene.importObject("table", new Mesh(new BoxGeometry(10, 2, 10)));
    scene.importObject("box", new Mesh(new BoxGeometry(2, 2, 2)));
    const measurement = scene.measure({ kind: "clearance", first: { objectId: "table" }, second: { objectId: "box" } });
    if (measurement.status !== "ok" || measurement.data.kind !== "clearance") throw new Error("Missing bounds");
    const delta = (measurement.data.firstBounds.max[1] ?? 0) + 0.1 - (measurement.data.secondBounds.min[1] ?? 0);
    expect(scene.execute("place", scene.currentRevision, [{ commandId: "move", type: "scene.move_object", objectId: "box", delta: [0, delta, 0] }]).status).toBe("applied");
    const result = scene.measure({ kind: "clearance", first: { objectId: "table" }, second: { objectId: "box" }, method: "surface" });
    if (result.status !== "ok" || result.data.kind !== "clearance") throw new Error("Missing surface result");
    expect(result.data.distance).toBeCloseTo(0.1, 6);
  });

  it("finds intersections and coplanar edge crossings as well as separated surfaces", () => {
    const triangle = (points: [number[], number[], number[]]) => new Triangle(
      new Vector3().fromArray(points[0]), new Vector3().fromArray(points[1]), new Vector3().fromArray(points[2]),
    );
    const a = triangle([[0, 0, 0], [2, 0, 0], [0, 2, 0]]);
    const b = triangle([[1, -1, -1], [1, 2, -1], [1, 0, 1]]);
    expect(closestSurface([a], [b])).toBe(0);
    expect(closestSurface([a], [triangle([[1, -1, 0], [3, 1, 0], [-1, 1, 0]])])).toBeCloseTo(0, 10);
    expect(closestSurface([a], [triangle([[0, 0, 2], [2, 0, 2], [0, 2, 2]])])).toBeCloseTo(2);
  });
});
