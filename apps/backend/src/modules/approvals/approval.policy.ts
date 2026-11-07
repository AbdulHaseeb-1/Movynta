import { Injectable } from "@nestjs/common";
import type { EditorCommand } from "@movynta/editor-protocol";

/** Assistant proposals apply automatically; validation, ownership and strict revisions still apply. */
@Injectable()
export class ApprovalPolicy {
  requiresApproval(_commands: readonly EditorCommand[]): boolean {
    return false;
  }
}
