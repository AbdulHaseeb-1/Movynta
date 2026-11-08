import { type BufferGeometry, Group, Mesh, MeshStandardMaterial, type Object3D } from "three";
import type { ModelFormat } from "./modelFormats";
import { parseObj } from "./objParser";

const decoder = new TextDecoder("utf-8");

/** The look given to geometry that comes without materials, matching the editor's own primitives. */
function defaultMaterial() {
  return new MeshStandardMaterial({ color: "#b6aaa4", roughness: 0.65 });
}

function meshOf(geometry: BufferGeometry): Mesh {
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const material = defaultMaterial();
  // Scanned and exported models often carry per-vertex color instead of a material.
  if (geometry.getAttribute("color")) material.vertexColors = true;
  return new Mesh(geometry, material);
}

/**
 * Reads a model file into three.js objects. The readers are loaded on demand, so they cost nothing
 * until the first import. Throws a readable message when the file cannot be understood.
 */
export async function parseModel(format: ModelFormat, data: ArrayBuffer): Promise<Object3D> {
  switch (format) {
    case "glb":
    case "gltf": {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      // A .gltf must hold its own data: references to separate .bin or texture files cannot be followed.
      const gltf = await new GLTFLoader().parseAsync(format === "gltf" ? decoder.decode(data) : data, "");
      return gltf.scene;
    }
    case "obj":
      // Read by our own scanner: on a large file it is several times faster than three.js's loader.
      return parseObj(decoder.decode(data), defaultMaterial());
    case "fbx": {
      const { FBXLoader } = await import("three/addons/loaders/FBXLoader.js");
      return new FBXLoader().parse(data, "");
    }
    case "stl": {
      const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
      return meshOf(new STLLoader().parse(data));
    }
    case "ply": {
      const { PLYLoader } = await import("three/addons/loaders/PLYLoader.js");
      return meshOf(new PLYLoader().parse(data));
    }
    case "dae": {
      const { ColladaLoader } = await import("three/addons/loaders/ColladaLoader.js");
      const collada = new ColladaLoader().parse(decoder.decode(data), "");
      if (!collada) throw new Error("The Collada file is empty or damaged");
      return collada.scene;
    }
    default: {
      const unsupported: never = format;
      throw new Error(`Unsupported model format: ${String(unsupported)}`);
    }
  }
}

/** Wraps parsed content so it can be placed as one object. */
export function wrap(content: Object3D): Group {
  const root = new Group();
  root.add(content);
  return root;
}
