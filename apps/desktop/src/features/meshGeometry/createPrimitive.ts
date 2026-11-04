import { BoxGeometry, ConeGeometry, CylinderGeometry, IcosahedronGeometry, OctahedronGeometry, PlaneGeometry, SphereGeometry, TetrahedronGeometry, TorusGeometry, type BufferGeometry } from "three";
import type { z } from "zod";
import type { editorCommandSchema } from "@movynta/editor-protocol";

type Primitive = Extract<z.infer<typeof editorCommandSchema>, { type: "geometry.create_primitive" }>;

/** Builds dimensions directly into the mesh, so the object transform stays independently editable. */
export function createPrimitive(command: Primitive): BufferGeometry {
  const { primitive, size, options = {} } = command;
  switch (primitive) {
    case "box": return new BoxGeometry(options.width ?? size, options.height ?? size, options.depth ?? size);
    case "plane": return new PlaneGeometry(options.width ?? size, options.height ?? size);
    case "sphere": return new SphereGeometry(options.radius ?? size / 2, options.widthSegments ?? 24, options.heightSegments ?? 16);
    case "cylinder": return new CylinderGeometry(options.radiusTop ?? size / 2, options.radiusBottom ?? size / 2, options.height ?? size, options.radialSegments ?? 24, options.heightSegments ?? 1);
    case "cone": return new ConeGeometry(options.radius ?? size / 2, options.height ?? size, options.radialSegments ?? 24, options.heightSegments ?? 1);
    case "torus": return new TorusGeometry(options.radius ?? size * 0.35, options.tube ?? size * 0.15, options.radialSegments ?? 12, options.tubularSegments ?? 32);
    case "tetrahedron": return new TetrahedronGeometry(options.radius ?? size / 2, options.detail ?? 0);
    case "octahedron": return new OctahedronGeometry(options.radius ?? size / 2, options.detail ?? 0);
    case "icosahedron": return new IcosahedronGeometry(options.radius ?? size / 2, options.detail ?? 0);
    default: throw new Error("Unsupported primitive");
  }
}
