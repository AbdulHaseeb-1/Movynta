import type { z } from "zod";
import type { editorCommandSchema } from "../schemas/editor-command.schema.js";

/** A command the assistant may propose, and a change the user makes by hand. */
export type EditorCommand = z.infer<typeof editorCommandSchema>;
export type EditorCommandType = EditorCommand["type"];
