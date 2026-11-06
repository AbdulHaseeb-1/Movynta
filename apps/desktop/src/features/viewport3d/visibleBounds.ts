import {
  type Box3,
  InstancedMesh,
  Line,
  Mesh,
  Points,
  SkinnedMesh,
  type Object3D,
} from "three";

type GeometryObject = Mesh | Line | Points;
function hasGeometry(node: Object3D): node is GeometryObject {
  return node instanceof Mesh || node instanceof Line || node instanceof Points;
}

/** Bounds of visible geometry only, including nested parts and current deformations. */
export function visibleBounds(root: Object3D, into: Box3): Box3 {
  root.updateWorldMatrix(true, true);
  root.traverseVisible((node) => {
    if (!hasGeometry(node)) return;
    let bounds: Box3 | null = null;
    if (node instanceof SkinnedMesh || node instanceof InstancedMesh) {
      node.computeBoundingBox();
      bounds = node.boundingBox;
    } else {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      bounds = node.geometry.boundingBox;
    }
    if (bounds && !bounds.isEmpty())
      into.union(bounds.clone().applyMatrix4(node.matrixWorld));
  });
  return into;
}
