import type { z } from "zod";
import type { editorContextSchema, editorObjectSchema } from "../schemas/editor-context.schema.js";

export type EditorObject = z.infer<typeof editorObjectSchema>;
export type EditorContext = z.infer<typeof editorContextSchema>;
