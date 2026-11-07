import { BufferGeometry, Float32BufferAttribute, Vector3 } from "three";
import { assertManifold, faceAreaNormal, topology, type PolygonMesh } from "./meshTopology";
import { writeGeometry } from "./meshOutput";

/** Validates and writes a bounded polygon cage from a structured editor command. */
export function createPolygonMesh(
  vertices: readonly (readonly number[])[],
  faces: readonly (readonly number[])[],
  shading: "flat" | "smooth" = "flat",
): BufferGeometry {
  const distinct = new Set<string>();
  for (const vertex of vertices) {
    const key = vertex.map((value) => Math.fround(value)).join(",");
    if (distinct.has(key)) throw new Error("Mesh vertices overlap at Float32 precision. Share vertex indices instead.");
    distinct.add(key);
  }
  const mesh: PolygonMesh = {
    positions: vertices.map((vertex) => new Vector3().fromArray(vertex.map((value) => Math.fround(value)))),
    faces: faces.map((face) => [...face]),
  };
  assertManifold(mesh, topology(mesh));
  for (const face of mesh.faces) {
    if (faceAreaNormal(mesh, face).lengthSq() <= 1e-20) throw new Error("A mesh face has zero area");
  }
  const source = new BufferGeometry();
  source.setAttribute("position", new Float32BufferAttribute(vertices.flat(), 3));
  try {
    return writeGeometry(source, mesh, shading === "flat");
  } finally {
    source.dispose();
  }
}
