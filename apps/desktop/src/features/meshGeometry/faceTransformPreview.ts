import type { BufferGeometry } from "three";
import { updateExtrudedWallUvs, writeExtrudedGeometry, type ExtrudeResult } from "./meshExtrude";
import { hardCageVertices, recomputeNormals, triangulate, writeGeometry } from "./meshOutput";

/** Reuse render buffers and retriangulate only the faces touched by the transform. */
export class FaceTransformPreview {
  readonly geometry: BufferGeometry;
  readonly result: ExtrudeResult;
  private readonly vertexIds: number[] = [];
  private readonly movedCorners: number[] = [];
  private readonly affected: { face: number[]; corner: number; index: number }[] = [];
  private readonly indices: number[];
  private readonly hard: Set<number>;

  constructor(source: BufferGeometry, result: ExtrudeResult, vertices: ReadonlySet<number>) {
    this.result = result;
    this.hard = hardCageVertices(source, result.mesh);
    this.geometry = result.walls.length
      ? writeExtrudedGeometry(source, result)
      : writeGeometry(source, result.mesh, false, this.hard);
    this.indices = Array.from(this.geometry.getIndex()?.array ?? []);
    let index = 0;
    for (const face of result.mesh.faces) {
      const corner = this.vertexIds.length;
      if (face.some((vertex) => vertices.has(vertex))) this.affected.push({ face, corner, index });
      for (const vertex of face) {
        if (vertices.has(vertex)) this.movedCorners.push(this.vertexIds.length);
        this.vertexIds.push(vertex);
      }
      index += (face.length - 2) * 3;
    }
  }

  update(next: ExtrudeResult): void {
    const rebuilt = this.affected.map(({ face, corner, index }) => {
      const triangles = triangulate(next.mesh, face);
      if (triangles.length !== face.length - 2) throw new Error("A face cannot be triangulated after this transform");
      return { index, indices: triangles.flat().map((id) => id + corner) };
    });
    const indexBuffer = this.geometry.getIndex();
    if (!indexBuffer) throw new Error("Missing face preview indices");
    for (const row of rebuilt)
      row.indices.forEach((value, i) => {
        this.indices[row.index + i] = value;
        indexBuffer.setX(row.index + i, value);
      });
    indexBuffer.needsUpdate = true;
    const positions = this.geometry.getAttribute("position");
    for (const corner of this.movedCorners) {
      const point = next.mesh.positions[this.vertexIds[corner] ?? -1];
      if (point) positions.setXYZ(corner, point.x, point.y, point.z);
    }
    positions.needsUpdate = true;
    this.result.mesh.positions = next.mesh.positions;
    if (next.walls.length) updateExtrudedWallUvs(this.geometry, next);
    recomputeNormals(this.geometry, this.indices, this.vertexIds, next.mesh.positions.length, true, this.hard);
    if (this.geometry.getAttribute("tangent") && this.geometry.getAttribute("uv")) this.geometry.computeTangents();
    this.geometry.computeBoundingBox();
    this.geometry.computeBoundingSphere();
  }
}
