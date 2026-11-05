import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import type { CommandProposalService } from "../../editor-bridge/proposals/command-proposal.service.js";
import type { MeasurementUnits } from "@movynta/editor-protocol";

export interface EditorToolDependencies {
  readonly bridge: EditorBridge;
  readonly proposals: CommandProposalService;
  readonly getUnits?: (userId: string, projectId: string) => MeasurementUnits;
}
