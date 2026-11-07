import type { EditorCommand } from "./editor-command.schema.js";

/**
 * Fills in what the assistant leaves out, where the editor's own default has to stay as it is for old projects. A saved
 * project replays the commands it recorded, so a field that was once optional keeps meaning "off" when it is missing. A new
 * proposal is not bound by that: filling the field in before the proposal is stored makes the stored command explicit, so
 * replay never depends on a default, and the assistant gets the choice that is right nearly every time.
 *
 * - `geometry.bevel_edges` without `trimEndFaces`: on. Left off, the faces at the ends of the beveled edge keep their sharp
 *   corner and extra faces cover the same patch again. The Edit-mode bevel already sends it on. An explicit false is kept.
 */
export function withAssistantDefaults(commands: readonly EditorCommand[]): EditorCommand[] {
  return commands.map((command) =>
    command.type === "geometry.bevel_edges" && command.trimEndFaces === undefined ? { ...command, trimEndFaces: true } : command,
  );
}
