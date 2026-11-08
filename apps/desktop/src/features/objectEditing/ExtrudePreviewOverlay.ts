import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  type Object3D,
  type Scene,
} from "three";
import { triangulate } from "@/features/meshGeometry/meshOutput";
import { edgeKey } from "@/features/meshGeometry/meshTopology";
import type { ExtrudeKind, ExtrudeResult } from "@/features/meshGeometry/meshExtrude";

interface Layer {
  geometry: BufferGeometry;
  vertices: number[];
}

function isDrawable(object: Object3D): object is Mesh | LineSegments | Points {
  return object instanceof Mesh || object instanceof LineSegments || object instanceof Points;
}

/** Temporary cage and selected cap drawn over the live extrusion preview. */
export class ExtrudePreviewOverlay {
  private readonly group = new Group();
  private readonly layers: Layer[] = [];
  private readonly result: ExtrudeResult;
  constructor(scene: Scene, source: Object3D, result: ExtrudeResult, kind: ExtrudeKind) {
    this.result = result;
    const edges = new Map<string, [number, number]>();
    for (const face of result.mesh.faces)
      face.forEach((a, index) => {
        const b = face[(index + 1) % face.length];
        if (b !== undefined) edges.set(edgeKey(a, b), [a, b]);
      });
    const wire = this.layer([...edges.values()].flat());
    this.group.add(new LineSegments(wire, new LineBasicMaterial({ color: 0x000000, depthTest: true })));
    if (kind === "vertex") {
      this.group.add(
        new Points(
          this.layer(result.mesh.positions.map((_, index) => index)),
          new PointsMaterial({
            color: 0x000000,
            size: 4,
            sizeAttenuation: false,
          }),
        ),
      );
      const selected = new Points(
        this.layer(result.selection.map(Number)),
        new PointsMaterial({
          color: 0xff9b21,
          size: 7,
          sizeAttenuation: false,
          depthTest: false,
        }),
      );
      selected.renderOrder = 1000;
      this.group.add(selected);
    } else if (kind === "edge") {
      const selected = new LineSegments(
        this.layer(result.selection.flatMap((id) => id.split("_").map(Number))),
        new LineBasicMaterial({ color: 0xff9b21, depthTest: false }),
      );
      selected.renderOrder = 1000;
      this.group.add(selected);
    } else {
      const triangles: number[] = [];
      const border: number[] = [];
      for (const id of result.selection) {
        const face = result.mesh.faces[Number(id)];
        if (!face) continue;
        for (const triangle of triangulate(result.mesh, face))
          for (const corner of triangle) {
            const vertex = face[corner];
            if (vertex !== undefined) triangles.push(vertex);
          }
        face.forEach((vertex, index) => {
          const next = face[(index + 1) % face.length];
          if (next !== undefined) border.push(vertex, next);
        });
      }
      const fill = new Mesh(
        this.layer(triangles),
        new MeshBasicMaterial({
          color: 0xff9b21,
          transparent: true,
          opacity: 0.35,
          side: DoubleSide,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -2,
        }),
      );
      fill.renderOrder = 1000;
      this.group.add(fill);
      const selected = new LineSegments(
        this.layer(border),
        new LineBasicMaterial({ color: 0xff9b21, depthTest: false }),
      );
      selected.renderOrder = 1001;
      this.group.add(selected);
    }
    this.group.matrixAutoUpdate = false;
    source.updateWorldMatrix(true, false);
    this.group.matrix.copy(source.matrixWorld);
    this.group.traverse((object) => {
      object.raycast = () => undefined;
    });
    this.update();
    scene.add(this.group);
  }
  private layer(vertices: number[]): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(vertices.length * 3), 3));
    this.layers.push({ geometry, vertices });
    return geometry;
  }
  update(): void {
    for (const { geometry, vertices } of this.layers) {
      const positions = geometry.getAttribute("position");
      vertices.forEach((id, index) => {
        const point = this.result.mesh.positions[id];
        if (point) positions.setXYZ(index, point.x, point.y, point.z);
      });
      positions.needsUpdate = true;
      geometry.computeBoundingSphere();
    }
  }
  dispose(): void {
    this.group.removeFromParent();
    this.group.traverse((object) => {
      if (isDrawable(object)) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }
}
