import { Injectable } from "@nestjs/common";
import type { EditorCommand } from "../../shared/types/editor-command.types.js";

/** Assistant proposals apply automatically; validation, ownership and strict revisions still apply. */
@Injectable()
export class ApprovalPolicy {
  requiresApproval(_commands: readonly EditorCommand[]): boolean {
    return false;
  }
}
