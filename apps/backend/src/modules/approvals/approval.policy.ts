import { Injectable } from "@nestjs/common";
import type { EditorCommand } from "../../shared/types/editor-command.types.js";

/** Batches larger than this always need a human decision, however harmless their commands are. */
export const LARGE_BATCH_THRESHOLD = 100;

/** Destructive commands remove or replace existing scene content. */
export function isDestructiveCommand(command: EditorCommand): boolean {
  return (
    command.type === "scene.delete_object" || command.type === "geometry.bevel" || command.type === "geometry.extrude" || command.type === "geometry.subdivide_faces" || (command.type === "geometry.subdivide" || command.type === "geometry.set_modifiers") || (command.type === "geometry.create_primitive" && command.replaceExisting)
  );
}

/** Decides which proposals need explicit user approval. Read-only operations never do. */
@Injectable()
export class ApprovalPolicy {
  requiresApproval(commands: readonly EditorCommand[]): boolean {
    return commands.length > LARGE_BATCH_THRESHOLD || commands.some(isDestructiveCommand);
  }
}
