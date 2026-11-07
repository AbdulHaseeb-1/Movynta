import {
  OrthographicCamera,
  PerspectiveCamera,
  Vector3,
  type Camera,
  type Raycaster,
  type Vector2,
} from "three";

/** Match ray distances to the camera's planar clipping range, including off-axis rays. */
export function setCameraRay(
  ray: Raycaster,
  cursor: Vector2,
  camera: Camera,
): void {
  ray.setFromCamera(cursor, camera);
  if (
    camera instanceof PerspectiveCamera ||
    camera instanceof OrthographicCamera
  ) {
    const forward = camera.getWorldDirection(new Vector3());
    const cosine = ray.ray.direction.dot(forward);
    ray.near = cosine > 0 ? camera.near / cosine : 0;
    ray.far = cosine > 0 ? camera.far / cosine : 0;
  } else {
    ray.near = 0;
    ray.far = Infinity;
  }
}
