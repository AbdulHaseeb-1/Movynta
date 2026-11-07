import { Box3, BufferAttribute, SkinnedMesh, Vector3, type BufferGeometry, type Material, type Object3D } from "three";
import { wrap } from "./parseModel";
import { isMesh } from "@/lib/three";

/** Models smaller or larger than this (in scene units) are scaled to {@link TARGET_SIZE}. */
const MIN_SIZE = 0.25;
const MAX_SIZE = 20;
const TARGET_SIZE = 2;

export interface PreparedModel {
  /** One object holding the whole model, ready to add to the scene. */
  object: Object3D;
  triangles: number;
  /** How much the file's size was multiplied to fit the scene: 1 when it was kept as it is. */
  scaleFactor: number;
  /** The longest side of the model as the file describes it, in the file's units. */
  originalSize: number;
}

/** What to tell the user when an import was resized, since real-world measurements depend on the original size. */
export function scaleNotice(name: string, scaleFactor: number, originalSize: number): string | undefined {
  if (scaleFactor === 1) return undefined;
  const number = (value: number) => new Intl.NumberFormat("en", { maximumSignificantDigits: 3 }).format(value);
  return `${name} was resized to fit the scene (longest side ${number(originalSize)} → ${number(originalSize * scaleFactor)} units, ×${number(scaleFactor)}). Divide measurements by ×${number(scaleFactor)} or set the scene scale to recover its original size.`;
}

/** Narrows to a mesh with the standard geometry and material types. */

function trianglesOf(geometry: BufferGeometry): number {
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  return index ? index.count / 3 : position ? position.count / 3 : 0;
}

/**
 * Gives the geometry its bounding box, reading the vertex array directly. three.js computes it
 * through per-vertex accessor calls, several times slower on a model of a million vertices; the
 * result is stored where three.js looks for it, so nothing downstream computes it again.
 */
function boundGeometry(geometry: BufferGeometry): void {
  if (geometry.boundingBox) return;
  const position = geometry.getAttribute("position");
  if (!(position instanceof BufferAttribute) || !(position.array instanceof Float32Array) || position.itemSize < 3) {
    geometry.computeBoundingBox();
    return;
  }
  const array = position.array;
  const stride = position.itemSize;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let at = 0; at + 2 < array.length; at += stride) {
    const x = array[at] ?? 0;
    const y = array[at + 1] ?? 0;
    const z = array[at + 2] ?? 0;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  geometry.boundingBox = new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));
}

/**
 * Makes an imported model fit the scene: lights and cameras that came with the file are dropped
 * (the scene has its own), the model is centered on the ground, and one that is absurdly small or
 * large (a file in millimeters, or a city) is scaled to a usable size. The outer object keeps an
 * identity transform, so moving it afterwards starts from a clean state. The result depends only on
 * the file, so reopening a project rebuilds the same placement.
 *
 * The model is walked once to find what to drop, what can be drawn and how many triangles it has, and
 * measured once; the final placement follows from that measurement by arithmetic, not a second walk.
 */
export function prepareModel(content: Object3D, name: string): PreparedModel {
  const unwanted: Object3D[] = [];
  let renderable = false;
  let triangles = 0;
  // A walk that does not enter what it drops, so a light's children are neither counted nor drawn.
  const pending: Object3D[] = [content];
  for (let node = pending.pop(); node; node = pending.pop()) {
    if ("isLight" in node || "isCamera" in node) {
      unwanted.push(node);
      continue;
    }
    if (isMesh(node)) {
      renderable = true;
      triangles += trianglesOf(node.geometry);
      boundGeometry(node.geometry);
    } else if ("isLine" in node || "isPoints" in node) {
      renderable = true;
    }
    for (const child of node.children) pending.push(child);
  }
  for (const node of unwanted) node.removeFromParent();
  if (!renderable) throw new Error("This file does not contain any 3D geometry");

  const root = wrap(content);
  root.name = name;
  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(root);
  const size = bounds.getSize(new Vector3());
  const largest = Math.max(size.x, size.y, size.z);
  if (!Number.isFinite(largest) || largest === 0)
    throw new Error("This model has no size, so it cannot be shown");

  // Scaling the content scales everything about the content's own origin, so the measured box
  // scales the same way and needs no second measurement.
  const min = bounds.min.clone();
  const max = bounds.max.clone();
  let scaleFactor = 1;
  if (largest < MIN_SIZE || largest > MAX_SIZE) {
    const factor = TARGET_SIZE / largest;
    scaleFactor = factor;
    const origin = content.position;
    content.scale.multiplyScalar(factor);
    min.sub(origin).multiplyScalar(factor).add(origin);
    max.sub(origin).multiplyScalar(factor).add(origin);
  }
  content.position.x -= (min.x + max.x) / 2;
  content.position.z -= (min.z + max.z) / 2;
  content.position.y -= min.y;

  return { object: root, triangles: Math.round(triangles), scaleFactor, originalSize: largest };
}

/** Frees the memory of a model that was prepared but never added to the scene. */
export function disposeModel(root: Object3D): void {
  root.traverse((node) => {
    if (!isMesh(node)) return;
    const geometry: BufferGeometry = node.geometry;
    geometry.dispose();
    const material: Material | Material[] = node.material;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((entry) => entry.dispose());
    if (node instanceof SkinnedMesh) node.skeleton.dispose();
  });
}
