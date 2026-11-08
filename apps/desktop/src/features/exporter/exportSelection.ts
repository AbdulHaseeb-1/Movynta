import {
  BufferAttribute,
  Matrix4,
  Quaternion,
  Scene,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
  type Object3D,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { clone as cloneHierarchy } from "three/addons/utils/SkeletonUtils.js";
import type { MeasurementUnits } from "@movynta/editor-protocol";
import { isMesh } from "@/lib/three";

/** What an export needs from the scene: the selection, the objects it names, and the project's calibration. */
export interface ExportSource {
  readonly selectedIds: readonly string[];
  getObject(id: string): Object3D | undefined;
  readonly calibration: MeasurementUnits;
}

/** A finished export, ready to be saved. */
export interface ExportedModel {
  blob: Blob;
  fileName: string;
}

/** The MIME type of a binary glTF file. */
export const GLB_MIME_TYPE = "model/gltf-binary";

/**
 * Blender measures in meters. A calibrated project says how many meters one scene unit is. An uncalibrated one
 * is taken as one meter per unit, which is Blender's own default, so the object keeps its size in Blender.
 */
export function metersPerSceneUnit(calibration: MeasurementUnits): number {
  return calibration?.metersPerSceneUnit ?? 1;
}

/** An object is drawn only if it and every object above it are visible, which is what the export takes. */
function isDrawn(object: Object3D): boolean {
  for (let node: Object3D | null = object; node; node = node.parent) if (!node.visible) return false;
  return true;
}

/**
 * The objects to export at the top of the selection: drawn objects that are not inside another selected object.
 * A selected object inside another one leaves with that object's hierarchy, so it is never exported twice.
 */
export function topLevelSelection(objects: readonly Object3D[]): Object3D[] {
  const drawn = objects.filter(isDrawn);
  const chosen = new Set(drawn);
  return drawn.filter((object) => {
    for (let parent = object.parent; parent; parent = parent.parent) if (chosen.has(parent)) return false;
    return true;
  });
}

/**
 * Copies the selection into a scene of its own, in the order it was chosen. Each copy takes the object's placement
 * in the workspace, in meters, so it lands where it is even when its parent is not exported. Its children come with
 * it and keep their placement relative to it. The copies share geometry and materials with the workspace but never
 * change it, and they carry no workspace state, so the file holds only what Blender needs.
 */
export function copySelectionForExport(source: ExportSource): Scene {
  const selected = source.selectedIds.flatMap((id) => source.getObject(id) ?? []);
  const objects = topLevelSelection(selected);
  if (objects.length === 0) throw new Error("Select a visible object to export it.");

  const scene = new Scene();
  const meters = metersPerSceneUnit(source.calibration);
  for (const object of objects) scene.add(copyForExport(object, meters));
  return scene;
}

/** Every object in a hierarchy, the root first, in the same order a clone of it is walked. */
function nodesOf(root: Object3D): Object3D[] {
  const nodes: Object3D[] = [];
  root.traverse((node) => {
    nodes.push(node);
  });
  return nodes;
}

/** One top-level object as a copy placed in meters, with its own transforms written so Blender reads them as they are. */
function copyForExport(object: Object3D, meters: number): Object3D {
  object.updateWorldMatrix(true, true);
  const toMeters = new Matrix4().makeScale(meters, meters, meters);
  const placement = new Matrix4().multiplyMatrices(toMeters, object.matrixWorld);
  const originals = nodesOf(object);
  const copy = cloneHierarchy(object);
  if (originals.some((node) => node.matrixWorld.determinant() < 0)) {
    bakeMirror(originals, nodesOf(copy), placement, toMeters);
  } else {
    placement.decompose(copy.position, copy.quaternion, copy.scale);
  }
  copy.traverse((node) => {
    node.userData = {};
  });
  return copy;
}

/**
 * Blender does not flip the faces of an object with a negative scale, so a mirror would show inside out. Where the
 * object holds a mirror, the copy is placed by the positive part of its placement, and every node below it sits
 * at its own origin in that frame, with its rotation and scale written into its meshes' geometry instead. The
 * faces of a mirrored mesh are turned so they still face outward. Names, the hierarchy and each object's origin
 * are kept, and the object looks in Blender as it does in the workspace.
 */
function bakeMirror(
  originals: readonly Object3D[],
  copies: readonly Object3D[],
  placement: Matrix4,
  toMeters: Matrix4,
): void {
  const [root] = copies;
  if (!root) return;
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  placement.decompose(position, rotation, scale);
  root.position.copy(position);
  root.quaternion.copy(rotation);
  root.scale.set(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z));
  const toFrame = new Matrix4().compose(root.position, root.quaternion, root.scale).invert();

  // Where each original node sits in the copy's frame: its matrix there, and so its origin and linear part.
  const frames = new Map<Object3D, Matrix4>();
  originals.forEach((original) => {
    frames.set(
      original,
      new Matrix4().multiplyMatrices(toFrame, new Matrix4().multiplyMatrices(toMeters, original.matrixWorld)),
    );
  });
  originals.forEach((original, index) => {
    const copy = copies[index];
    const frame = frames.get(original);
    if (!copy || !frame) return;
    if (copy !== root) {
      // The node's origin relative to its parent's origin, with no rotation or scale of its own.
      const origin = new Vector3().setFromMatrixPosition(frame);
      const parentFrame = original.parent ? frames.get(original.parent) : undefined;
      const parentOrigin = parentFrame ? new Vector3().setFromMatrixPosition(parentFrame) : new Vector3();
      copy.position.copy(origin).sub(parentOrigin);
      copy.quaternion.identity();
      copy.scale.set(1, 1, 1);
    }
    if (!isMesh(copy)) return;
    if (copy instanceof SkinnedMesh)
      throw new Error("A mirrored object with a skinned mesh cannot be exported for Blender yet.");
    // The rotation, scale and mirror, without the translation the node already carries.
    const linear = frame.clone().setPosition(0, 0, 0);
    copy.geometry = placedGeometry(copy.geometry, linear);
  });
}

/** A copy of the geometry moved by `matrix`. A matrix that mirrors turns the faces inside out, so their winding is reversed. */
function placedGeometry(geometry: BufferGeometry, matrix: Matrix4): BufferGeometry {
  const placed = geometry.clone().applyMatrix4(matrix);
  if (matrix.determinant() < 0) reverseWinding(placed);
  return placed;
}

/** Turns every triangle around, so its front faces the other way. Works on the geometry's own index, which is made if it has none. */
function reverseWinding(geometry: BufferGeometry): void {
  const index = geometry.getIndex();
  if (index) {
    const order = index.array;
    for (let at = 0; at + 2 < order.length; at += 3) {
      const second = order[at + 1] ?? 0;
      order[at + 1] = order[at + 2] ?? 0;
      order[at + 2] = second;
    }
    index.needsUpdate = true;
    return;
  }
  const count = geometry.getAttribute("position").count;
  const order = new Uint32Array(count);
  for (let vertex = 0; vertex < count; vertex += 1) order[vertex] = vertex;
  for (let at = 0; at + 2 < count; at += 3) {
    order[at + 1] = at + 2;
    order[at + 2] = at + 1;
  }
  geometry.setIndex(new BufferAttribute(order, 1));
}

/**
 * Encodes a scene as one binary glTF (.glb) file. glTF is Y-up, like the workspace, and Blender's importer turns
 * it into Blender's Z-up on the way in, so orientation, names, hierarchy, materials and normals arrive unchanged.
 */
export async function encodeGlb(scene: Scene): Promise<Blob> {
  const encoded = await new GLTFExporter().parseAsync(scene, {
    binary: true,
    onlyVisible: true,
    // Position, rotation and scale per node, which Blender shows as the object's own transform.
    trs: true,
  });
  if (!(encoded instanceof ArrayBuffer)) throw new Error("The selection could not be encoded as a GLB file.");
  return new Blob([encoded], { type: GLB_MIME_TYPE });
}

const MODEL_EXTENSION = /\.(glb|gltf|obj|fbx|stl|ply|dae|blend)$/i;
const FORBIDDEN_IN_NAMES = '<>:"/\\|?*';

/** A file name for the export: the object's own name for one object, or "selection" for several. */
export function exportFileName(names: readonly string[]): string {
  const [only] = names;
  const base = names.length === 1 && only !== undefined ? only.replace(MODEL_EXTENSION, "") : "selection";
  const safe = base
    .split("")
    .map((character) => (character.charCodeAt(0) < 32 || FORBIDDEN_IN_NAMES.includes(character) ? "_" : character))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, "")
    .slice(0, 80);
  return `${safe || "selection"}.glb`;
}

/**
 * Exports the selection as a .glb file for Blender. The copy is taken when this is called, so the file holds the
 * selection as it was at that moment, even if the scene changes while the file is being encoded.
 */
export async function exportSelectionAsGlb(source: ExportSource): Promise<ExportedModel> {
  const scene = copySelectionForExport(source);
  const blob = await encodeGlb(scene);
  return { blob, fileName: exportFileName(scene.children.map((child) => child.name)) };
}

/** What the Save dialog offers for an exported selection. */
export const GLB_SAVE_OPTIONS = {
  title: "Export for Blender",
  filters: [{ name: "glTF binary (Blender)", extensions: ["glb"] }],
};
