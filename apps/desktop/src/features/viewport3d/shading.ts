import {
  DoubleSide,
  Line,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  type Material,
  type Object3D,
  type Scene,
  type WebGLRenderer,
  type Camera,
} from "three";
import { isMesh } from "@/lib/three";

/** How the viewport shades the scene: default, solid or wireframe. */
export type ShadingMode = "default" | "solid" | "wireframe";

/** How much of a surface shows in Solid X-ray; the rest lets what is behind it through. */
export const SOLID_XRAY_OPACITY = 0.35;

/**
 * Temporarily substitutes only editor meshes while drawing, never while editing or capturing.
 * Solid and Wireframe can draw see-through (X-ray); Material shading ignores it.
 */
export function createShadingRenderer(scene: Scene, renderer: WebGLRenderer, camera: Camera) {
  const solid = new MeshStandardMaterial({ color: 0xb6b6b6, roughness: 0.8, side: DoubleSide });
  // Without depth writes every layer shows, so hidden parts of a model read through the ones in front.
  const solidXray = new MeshStandardMaterial({
    color: 0xb6b6b6,
    roughness: 0.8,
    side: DoubleSide,
    transparent: true,
    opacity: SOLID_XRAY_OPACITY,
    depthWrite: false,
  });
  const wire = new MeshBasicMaterial({ color: 0xd5d5d5, wireframe: true, side: DoubleSide });
  const depth = new MeshBasicMaterial({
    colorWrite: false,
    side: DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  let mode: ShadingMode = "default";
  let xray = false;
  let belongsToModel: (object: Object3D) => boolean = () => false;

  return {
    setMode(next: ShadingMode, nextXray: boolean) {
      mode = next;
      xray = nextXray;
    },
    setModelPredicate(predicate: (object: Object3D) => boolean) {
      belongsToModel = predicate;
    },
    render(draw: () => void) {
      if (mode === "default") {
        draw();
        return;
      }
      const meshes: { mesh: Mesh; material: Material | Material[] }[] = [];
      const helpers: Object3D[] = [];
      scene.traverse((object) => {
        if (isMesh(object) && belongsToModel(object)) meshes.push({ mesh: object, material: object.material });
        else if (object.visible && (object instanceof Mesh || object instanceof Line || object instanceof Points))
          helpers.push(object);
      });
      const autoClear = renderer.autoClear;
      try {
        if (mode === "wireframe" && !xray) {
          for (const { mesh } of meshes) mesh.material = depth;
          for (const helper of helpers) helper.visible = false;
          try {
            renderer.render(scene, camera);
          } finally {
            for (const helper of helpers) helper.visible = true;
          }
          renderer.autoClear = false;
        }
        wire.depthTest = !xray;
        const substitute = mode === "solid" ? (xray ? solidXray : solid) : wire;
        for (const { mesh } of meshes) mesh.material = substitute;
        draw();
      } finally {
        for (const { mesh, material } of meshes) mesh.material = material;
        renderer.autoClear = autoClear;
      }
    },
    dispose() {
      solid.dispose();
      solidXray.dispose();
      wire.dispose();
      depth.dispose();
    },
  };
}
