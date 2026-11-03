import { Box3, Mesh, type BufferGeometry, type Object3D } from "three";

function isMesh(node: Object3D): node is Mesh {
  return node instanceof Mesh;
}

/** One bottom-up pass, including imported subtrees, rather than traversing each parent's subtree again. */
export function sceneBounds(roots: Iterable<Object3D>): ReadonlyMap<Object3D, Box3> {
  const bounds = new Map<Object3D, Box3>();
  const pending = [...roots].map((node) => ({ node, expanded: false }));
  while (pending.length > 0) {
    const entry = pending.pop();
    if (!entry || bounds.has(entry.node)) continue;
    const { node, expanded } = entry;
    if (!expanded) {
      pending.push({ node, expanded: true });
      for (const child of node.children) {
        if (!bounds.has(child)) pending.push({ node: child, expanded: false });
      }
      continue;
    }
    const box = new Box3();
    if (isMesh(node)) {
      const geometry: BufferGeometry = node.geometry;
      if (geometry.boundingBox === null) geometry.computeBoundingBox();
      if (geometry.boundingBox) box.copy(geometry.boundingBox).applyMatrix4(node.matrixWorld);
    }
    for (const child of node.children) {
      const childBounds = bounds.get(child);
      if (childBounds) box.union(childBounds);
    }
    bounds.set(node, box);
  }
  return bounds;
}
