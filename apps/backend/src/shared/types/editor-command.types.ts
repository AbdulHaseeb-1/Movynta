import type { z } from "zod";
import type { editorCommandSchema } from "../schemas/editor-command.schema.js";

export type EditorCommand = z.infer<typeof editorCommandSchema>;
export type EditorCommandType = EditorCommand["type"];
