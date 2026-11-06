import type { ScenarioCommand } from "./types";

export type Vec3 = readonly [number, number, number];

/** An empty group, optionally placed. */
export function group(objectId: string, name: string, position?: Vec3): ScenarioCommand {
  return { commandId: `make-${objectId}`, type: "scene.create_object", objectId, name, ...(position ? { transform: { position } } : {}) };
}

/**
 * Builders for the parts of one group. Every length and place is multiplied by `scale`, so a defective answer that is
 * the wrong size is the same build made too large or too small.
 */
export function kit(parentId: string, scale = 1) {
  const s = (value: number): number => value * scale;
  const at = ([x, y, z]: Vec3): { position: Vec3 } => ({ position: [s(x), s(y), s(z)] });
  return {
    box: (objectId: string, name: string, [width, height, depth]: Vec3, position: Vec3): ScenarioCommand => ({
      commandId: `make-${objectId}`, type: "geometry.create_primitive", objectId, primitive: "box", replaceExisting: false, name, parentId,
      size: s(Math.max(width, height, depth)), options: { width: s(width), height: s(height), depth: s(depth) }, transform: at(position),
    }),
    cylinder: (objectId: string, name: string, radius: number, height: number, position: Vec3): ScenarioCommand => ({
      commandId: `make-${objectId}`, type: "geometry.create_primitive", objectId, primitive: "cylinder", replaceExisting: false, name, parentId,
      size: s(Math.max(radius * 2, height)), options: { radiusTop: s(radius), radiusBottom: s(radius), height: s(height) }, transform: at(position),
    }),
    sphere: (objectId: string, name: string, radius: number, position: Vec3): ScenarioCommand => ({
      commandId: `make-${objectId}`, type: "geometry.create_primitive", objectId, primitive: "sphere", replaceExisting: false, name, parentId,
      size: s(radius * 2), options: { radius: s(radius) }, transform: at(position),
    }),
    /** A ring lying in the x-y plane. */
    torus: (objectId: string, name: string, radius: number, tube: number, position: Vec3): ScenarioCommand => ({
      commandId: `make-${objectId}`, type: "geometry.create_primitive", objectId, primitive: "torus", replaceExisting: false, name, parentId,
      size: s(radius * 2), options: { radius: s(radius), tube: s(tube) }, transform: at(position),
    }),
  };
}
