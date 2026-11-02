import { z } from "zod";
import {
  MAX_COMMANDS_PER_PROPOSAL,
  editorCommandSchema,
  identifierSchema,
  transformSchema,
} from "./editor-command.schema.js";

/**
 * Sets the local transform of one bone of an imported model's rig. A bone is named by its position in
 * the rig's bone list (see `rigOf` in the editor), which depends only on the model file, so the same
 * command rebuilds the same pose whenever the project is reopened.
 *
 * Posing is a change the user makes by hand: it is not part of {@link editorCommandSchema}, so the
 * assistant cannot propose it.
 */
export const poseBoneCommandSchema = z
  .object({
    commandId: identifierSchema,
    type: z.literal("rig.pose_bone"),
    objectId: identifierSchema,
    bone: z.number().int().nonnegative(),
    transform: transformSchema,
  })
  .strict();

/**
 * Everything the scene can replay: the assistant's commands plus the changes the user makes by hand.
 * The editor applies this union and the backend records it; only {@link editorCommandSchema} is sent
 * to the assistant.
 */
export const sceneCommandSchema = z.discriminatedUnion("type", [
  ...editorCommandSchema.options,
  poseBoneCommandSchema,
]);

export const sceneCommandListSchema = z.array(sceneCommandSchema).min(1).max(MAX_COMMANDS_PER_PROPOSAL);
