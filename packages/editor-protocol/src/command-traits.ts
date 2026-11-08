/**
 * Which commands share which rules. The proposal service, the replay index, the protocol validator and the
 * desktop editor all need the same answers, so the lists live here once. A new mesh command is added to
 * these lists and every layer picks it up; forgetting one place no longer changes behavior silently.
 */

/**
 * Commands that rewrite the base cage of one mesh part. They share one component-edit batch (at most 20 commands),
 * work on base IDs from `editor.inspect_mesh` and need the inspection's revision.
 */
export const CAGE_EDIT_COMMAND_TYPES: ReadonlySet<string> = new Set([
  "material.assign",
  "geometry.extrude",
  "geometry.inset_faces",
  "geometry.bevel_edges",
  "geometry.subdivide_faces",
  "geometry.fill_hole",
  "geometry.transform_components",
  "geometry.transform_faces",
  "geometry.slide_edges",
  "geometry.flip_normals",
  "geometry.set_shading",
  "geometry.separate_faces",
  "geometry.bridge_edge_loops",
  "geometry.merge_vertices",
  "geometry.merge_by_distance",
  "geometry.remove_duplicate_faces",
  "geometry.correct_normals",
  "geometry.knife_chord",
  "geometry.knife_path",
  "geometry.dissolve_edges",
  "geometry.loop_cut",
  "geometry.bisect",
  "geometry.delete_components",
  "geometry.triangulate_faces",
]);

/**
 * Cage edits that renumber vertices, edges or faces. Each one is a proposal of its own, with enabled modifiers
 * disabled, because the IDs a later command would use no longer mean what they did.
 */
export const TOPOLOGY_EDIT_COMMAND_TYPES: ReadonlySet<string> = new Set([
  "geometry.bevel_edges",
  "geometry.merge_vertices",
  "geometry.merge_by_distance",
  "geometry.remove_duplicate_faces",
  "geometry.correct_normals",
  "geometry.knife_chord",
  "geometry.knife_path",
  "geometry.dissolve_edges",
  "geometry.loop_cut",
  "geometry.bisect",
  "geometry.delete_components",
  "geometry.triangulate_faces",
  "geometry.separate_faces",
]);

/** Live modifier-stack commands: they append to or replace the stack and leave the base cage alone. */
export const MODIFIER_COMMAND_TYPES: ReadonlySet<string> = new Set([
  "geometry.bevel",
  "geometry.boolean",
  "geometry.subdivide",
  "geometry.set_modifiers",
]);

interface TypedCommand {
  readonly type: string;
}

/** Whether a command edits the base cage of a mesh, the shape that its modifiers are applied to. */
export function isCageEditCommand(command: TypedCommand): boolean {
  return CAGE_EDIT_COMMAND_TYPES.has(command.type);
}

/** Whether a command changes a mesh's topology, its faces and edges. Such edits are proposed alone, with modifiers off. */
export function isTopologyEditCommand(command: TypedCommand): boolean {
  return TOPOLOGY_EDIT_COMMAND_TYPES.has(command.type);
}

/** Whether a command sets a mesh's modifier stack. */
export function isModifierCommand(command: TypedCommand): boolean {
  return MODIFIER_COMMAND_TYPES.has(command.type);
}

/** A cage edit that names base IDs, so it is only meaningful against the revision those IDs were read from. */
export function usesBaseIds(command: TypedCommand): boolean {
  return isCageEditCommand(command) && "componentView" in command && command.componentView === "base";
}

/** Commands that change geometry or materials of an object that already exists, so they create nothing. */
export function editsExistingGeometry(command: TypedCommand): boolean {
  return (
    isCageEditCommand(command) ||
    isModifierCommand(command) ||
    command.type === "material.add_slot" ||
    command.type === "material.replace_slot" ||
    command.type === "material.set_properties"
  );
}
