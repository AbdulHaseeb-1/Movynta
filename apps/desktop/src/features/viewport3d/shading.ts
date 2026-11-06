import { DoubleSide, Line, Mesh, MeshBasicMaterial, MeshStandardMaterial, Points, type Material, type Object3D, type Scene, type WebGLRenderer, type Camera } from "three";

export type ShadingMode = "default" | "solid" | "wireframe";

function isMesh(object: Object3D): object is Mesh { return object instanceof Mesh; }

/** Temporarily substitutes only editor meshes while drawing, never while editing or capturing. */
export function createShadingRenderer(scene: Scene, renderer: WebGLRenderer, camera: Camera) {
  const solid = new MeshStandardMaterial({ color: 0xb6b6b6, roughness: 0.8, side: DoubleSide });
  const wire = new MeshBasicMaterial({ color: 0xd5d5d5, wireframe: true, side: DoubleSide });
  const depth = new MeshBasicMaterial({ colorWrite: false, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  let mode: ShadingMode = "default";
  let xray = false;
  let belongsToModel: (object: Object3D) => boolean = () => false;

  return {
    setMode(next: ShadingMode, nextXray: boolean) { mode = next; xray = nextXray; },
    setModelPredicate(predicate: (object: Object3D) => boolean) { belongsToModel = predicate; },
    render(draw: () => void) {
      if (mode === "default") { draw(); return; }
      const meshes: { mesh: Mesh; material: Material | Material[] }[] = [];
      const helpers: Object3D[] = [];
      scene.traverse((object) => {
        if (isMesh(object) && belongsToModel(object)) meshes.push({ mesh: object, material: object.material });
        else if (object.visible && (object instanceof Mesh || object instanceof Line || object instanceof Points)) helpers.push(object);
      });
      const autoClear = renderer.autoClear;
      try {
        if (mode === "wireframe" && !xray) {
          for (const { mesh } of meshes) mesh.material = depth;
          for (const helper of helpers) helper.visible = false;
          try { renderer.render(scene, camera); } finally { for (const helper of helpers) helper.visible = true; }
          renderer.autoClear = false;
        }
        wire.depthTest = !xray;
        for (const { mesh } of meshes) mesh.material = mode === "solid" ? solid : wire;
        draw();
      } finally {
        for (const { mesh, material } of meshes) mesh.material = material;
        renderer.autoClear = autoClear;
      }
    },
    dispose() { solid.dispose(); wire.dispose(); depth.dispose(); },
  };
}
