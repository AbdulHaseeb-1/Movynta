import type { Vector3, BufferGeometry } from "three";
import { hardCageVertices, recomputeNormals } from "./meshOutput";
import {
  updateExtrudedWallUvs,
  writeExtrudedGeometry,
  ZeroAreaWallError,
  type ExtrudeResult,
} from "./meshExtrude";

/** Reuses the topology of a face extrusion while its cap moves as one rigid region. */
export class ExtrudeFacePreview {
  readonly geometry: BufferGeometry;
  readonly result: ExtrudeResult;
  private readonly moved = new Map<number, Vector3>();
  private readonly vertexIds: number[] = [];
  private readonly indices: number[];
  private readonly hard: Set<number>;
  constructor(source: BufferGeometry, result: ExtrudeResult, offset: Vector3) {
    this.result = result;
    for (const id of result.selection) {
      for (const vertex of result.mesh.faces[Number(id)] ?? []) {
        const position = result.mesh.positions[vertex];
        if (position && !this.moved.has(vertex))
          this.moved.set(vertex, position.clone().sub(offset));
      }
    }
    this.geometry = writeExtrudedGeometry(source, result);
    for (const face of result.mesh.faces) for (const vertex of face) this.vertexIds.push(vertex);
    this.indices = Array.from(this.geometry.index?.array ?? []);
    this.hard = hardCageVertices(source, result.mesh);
  }

  update(offset: Vector3): void {
    // Validate all walls before changing anything, so a blocked move keeps the last valid preview.
    for (const id of this.result.walls) {
      const face = this.result.mesh.faces[id];
      const a =
        face?.[0] === undefined
          ? undefined
          : this.result.mesh.positions[face[0]];
      const b =
        face?.[1] === undefined
          ? undefined
          : this.result.mesh.positions[face[1]];
      if (!a || !b) throw new Error("Missing extruded vertex");
      const edge = b.clone().sub(a);
      const sine =
        edge.clone().cross(offset).length() / (edge.length() * offset.length());
      if (!(sine > 1e-6)) throw new ZeroAreaWallError();
    }
    for (const [id, origin] of this.moved)
      this.result.mesh.positions[id]?.copy(origin).add(offset);
    const positions = this.geometry.getAttribute("position");
    this.vertexIds.forEach((id, index) => {
      if (!this.moved.has(id)) return;
      const point = this.result.mesh.positions[id];
      if (point) positions.setXYZ(index, point.x, point.y, point.z);
    });
    positions.needsUpdate = true;
    updateExtrudedWallUvs(this.geometry, this.result);
    recomputeNormals(
      this.geometry,
      this.indices,
      this.vertexIds,
      this.result.mesh.positions.length,
      true,
      this.hard,
    );
    if (
      this.geometry.getAttribute("tangent") &&
      this.geometry.getAttribute("uv")
    )
      this.geometry.computeTangents();
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
  }
}
