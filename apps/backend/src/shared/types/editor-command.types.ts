import type { z } from "zod";
import type { editorCommandSchema, sceneCommandSchema } from "../schemas/editor-command.schema.js";

/** A command the assistant may propose. */
export type EditorCommand = z.infer<typeof editorCommandSchema>;
/** A command the scene can replay: the assistant's, or a change the user made by hand. */
export type SceneCommand = z.infer<typeof sceneCommandSchema>;
export type EditorCommandType = EditorCommand["type"];
