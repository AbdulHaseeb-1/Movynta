/**
 * The commands a person makes by hand in the editor, which the backend records with the project (the assistant's
 * commands go through proposals instead). It lives here, beside the commands themselves, so that a test in the
 * desktop can check that everything the interface sends is on it: a command that is not would be refused when saved.
 */
export const HAND_EDIT_COMMAND_TYPES: ReadonlySet<string> = new Set([
  "scene.transform_object",
  "scene.set_visibility",
  "scene.rename_object",
  "scene.set_parent",
  "scene.delete_object",
  "scene.create_collection",
  "scene.rename_collection",
  "scene.set_collection_visibility",
  "scene.move_collection",
  "scene.delete_collection",
  "scene.move_to_collection",
  "geometry.set_modifiers",
  "geometry.create_primitive",
  "geometry.extrude",
  "geometry.transform_faces",
  "geometry.subdivide_faces",
  "geometry.inset_faces",
]);
