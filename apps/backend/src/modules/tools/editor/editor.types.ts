import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import type { CommandProposalService } from "../../editor-bridge/proposals/command-proposal.service.js";

export interface EditorToolDependencies {
  readonly bridge: EditorBridge;
  readonly proposals: CommandProposalService;
}
