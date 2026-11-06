import { Mesh, Vector3, type Object3D } from "three";
import type { EditorScene } from "../EditorScene";
import { triangulate } from "../../meshGeometry/meshOutput";
import { boundaryLoops } from "../../meshGeometry/meshRegions";
import { readTopology, topology } from "../../meshGeometry/meshTopology";
import type { MeshMeasure } from "./types";

function isMesh(object: Object3D | undefined): object is Mesh {
  return object instanceof Mesh;
}

/** Measures the base cage of one mesh object, or undefined when the object is missing or is not a mesh. */
export function measureMesh(editor: EditorScene, objectId: string): MeshMeasure | undefined {
  const object = editor.getObject(objectId);
  if (!isMesh(object)) return undefined;
  object.updateWorldMatrix(true, false);
  const cage = readTopology(object.geometry);
  const graph = topology(cage);

  let volume = 0;
  for (const face of cage.faces) {
    for (const triangle of triangulate(cage, face)) {
      const [a, b, c] = triangle.map((corner) => cage.positions[face[corner] ?? -1]);
      if (a && b && c) volume += a.dot(b.clone().cross(c)) / 6;
    }
  }

  const edges = [...graph.edges.values()];
  const loops = boundaryLoops(graph).loops;
  const openingCenters = loops.map((loop) => {
    const sum = new Vector3();
    for (const vertex of loop.vertices) {
      const position = cage.positions[vertex];
      if (position) sum.add(position);
    }
    return sum.divideScalar(Math.max(1, loop.vertices.length)).applyMatrix4(object.matrixWorld).toArray();
  });
  return {
    faces: cage.faces.length,
    openEdges: edges.filter((edge) => edge.length !== 2).length,
    openings: loops.length,
    openingCenters,
    volume,
  };
}
