import { Injectable } from "@nestjs/common";
import type { EditorCommand } from "../../shared/schemas/editor-command.schema.js";

/** Batches larger than this always need a human decision. */
export const LARGE_BATCH_THRESHOLD = 20;

/** Destructive commands remove or replace existing scene content. */
export function isDestructiveCommand(command: EditorCommand): boolean {
  return (
    command.type === "scene.delete_object" || (command.type === "geometry.create_primitive" && command.replaceExisting)
  );
}

/** Decides which proposals need explicit user approval. Read-only operations never do. */
@Injectable()
export class ApprovalPolicy {
  requiresApproval(commands: readonly EditorCommand[]): boolean {
    return commands.length > LARGE_BATCH_THRESHOLD || commands.some(isDestructiveCommand);
  }
}
