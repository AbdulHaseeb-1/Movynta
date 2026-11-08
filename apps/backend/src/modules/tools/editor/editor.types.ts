import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import type { CommandProposalService } from "../../editor-bridge/proposals/command-proposal.service.js";
import type { MeasurementUnits } from "@movynta/editor-protocol";

/** The services that the editor tools are built from. */
export interface EditorToolDependencies {
  readonly bridge: EditorBridge;
  readonly proposals: CommandProposalService;
  readonly getUnits?: (userId: string, projectId: string) => MeasurementUnits;
}
