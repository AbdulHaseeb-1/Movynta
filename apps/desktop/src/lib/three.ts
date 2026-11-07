import { Mesh, type Object3D } from "three";

/** Whether a scene node is a mesh. The editor, the viewport and the tests all ask this question. */
export function isMesh(object: Object3D | undefined): object is Mesh {
  return object instanceof Mesh;
}
