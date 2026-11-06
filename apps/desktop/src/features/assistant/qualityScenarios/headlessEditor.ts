import { z } from "zod";
import { measurementRequestSchema, meshInspectionRequestSchema } from "@movynta/editor-protocol";
import { executeSafely, executionSchema } from "../commandExecution";
import type { EditorScene } from "../EditorScene";

/** One message of the editor bridge, in either direction. */
export interface BridgeMessage {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

export const bridgeMessageSchema = z.object({ event: z.string(), data: z.record(z.string(), z.unknown()) });

/**
 * The editor's half of the bridge without a window: it answers the backend's requests from a real `EditorScene`, exactly
 * as the desktop app does, so a run can be driven and judged without the app. It has no viewport, so a request to
 * look at the scene is answered with an error and the assistant works from measurements, as it does with a model that
 * cannot see pictures.
 */
export class HeadlessEditor {
  readonly editor: EditorScene;
  /** Requests the editor could not read or run. A run that depends on one will stall, so a result reports them. */
  readonly faults: string[] = [];

  constructor(editor: EditorScene) {
    this.editor = editor;
  }

  /** The messages to send back for one message from the backend. Messages that need no answer give none. */
  respond(message: BridgeMessage): BridgeMessage[] {
    const requestId = message.data["requestId"];
    switch (message.event) {
      case "context.request": {
        if (typeof requestId !== "string") return [];
        const { inspection, measurement } = message.data;
        return [{
          event: "context.response",
          data: {
            requestId,
            context: this.editor.context(
              inspection === undefined ? undefined : meshInspectionRequestSchema.parse(inspection),
              measurement === undefined ? undefined : measurementRequestSchema.parse(measurement),
            ),
          },
        }];
      }
      case "commands.execute": {
        const request = executionSchema.parse(message.data);
        return [{ event: "commands.result", data: { requestId: request.requestId, ...executeSafely(this.editor, request) } }];
      }
      case "view.request":
        return typeof requestId === "string" ? [{ event: "view.error", data: { requestId, message: "No viewport is available in this run" } }] : [];
      default:
        return [];
    }
  }
}
