import type { ViewCaptureOptions } from "../../editor-bridge/editor-bridge.types.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import type { ViewCaptureRequest, ViewCaptureResult } from "@movynta/editor-protocol";
import type { AgentRunContext } from "../../agent-runs/agent-runs.types.js";
import type { CommandProposalRecord } from "../../editor-bridge/proposals/proposals.types.js";
import { RichToolResult } from "../tool-result.js";
import { createViewportTools } from "./viewport.tools.js";

const captured: ViewCaptureResult = {
  images: [
    {
      label: "front",
      mediaType: "image/jpeg",
      data: "AAAA",
      width: 768,
      height: 576,
      camera: { projection: "orthographic", position: [0, 0, 10], target: [0, 0, 0], fov: null, orthographicHeight: 4 },
      objects: [{ id: "torso", name: "Torso", screenBounds: { x: 1, y: 2, width: 3, height: 4 }, inFrame: true }],
    },
    {
      label: "top",
      mediaType: "image/jpeg",
      data: "BBBB",
      width: 768,
      height: 576,
      camera: { projection: "orthographic", position: [0, 10, 0], target: [0, 0, 0], fov: null, orthographicHeight: 4 },
      objects: [],
    },
  ],
  scene: { objectCount: 1, bounds: { min: [-1, 0, -1], max: [1, 2, 1] } },
  focus: [{ id: "torso", name: "Torso", bounds: { min: [-1, 0, -1], max: [1, 2, 1] }, size: [2, 2, 2], center: [0, 1, 0] }],
  missingIds: [],
};

class RecordingBridge implements EditorBridge {
  readonly requests: { request: ViewCaptureRequest; options: ViewCaptureOptions }[] = [];
  result: ViewCaptureResult = captured;

  assertConnection(userId: string, projectId: string, clientId: string) {
    return { userId, projectId, clientId };
  }
  getContext(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }
  proposeCommands(): Promise<void> {
    return Promise.resolve();
  }
  executeCommands(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }
  captureViews(_clientId: string, request: ViewCaptureRequest, options: ViewCaptureOptions): Promise<ViewCaptureResult> {
    this.requests.push({ request, options });
    return Promise.resolve(this.result);
  }
}

/** Every event a tool emitted, so tests can check what the chat is told. */
const emitted: { type: string; payload: unknown }[] = [];

beforeEach(() => {
  emitted.length = 0;
});

function contextWith(supportsToolImages: boolean): AgentRunContext {
  return {
    runId: "run_1",
    userId: "alice",
    projectId: "proj-1",
    sessionId: "ses_1",
    clientId: "client-1",
    dimension: undefined,
    selectedSkillIds: [],
    events: { emit: (type: string, payload: unknown) => emitted.push({ type, payload }) } as never,
    signal: new AbortController().signal,
    plans: [],
    supportsToolImages,
  };
}

function tool(bridge: EditorBridge, requireProposal: (runId: string, proposalId: string) => CommandProposalRecord = () => { throw new Error("Unused proposal lookup"); }) {
  const [definition] = createViewportTools({ bridge, proposals: { require: requireProposal } });
  if (!definition) throw new Error("The viewport tool is missing");
  return definition;
}

describe("viewport.capture", () => {
  it("looks up the run's pending proposal and sends only the stored candidate", async () => {
    const bridge = new RecordingBridge();
    const proposal: CommandProposalRecord = {
      id: "prp_1", runId: "run_1", projectId: "proj-1", clientId: "client-1",
      baseRevision: 4, strictRevision: true, summary: "Extrude", requiresApproval: true,
      status: "proposed", result: undefined, createdAt: "", updatedAt: "",
      commands: [{ commandId: "ex", type: "geometry.extrude", objectId: "torso", meshPath: [], kind: "face", ids: ["0"], normalDistance: 1 }],
    };
    const request: ViewCaptureRequest = { proposalId: proposal.id, views: [{ preset: "front" }] };
    await tool(bridge, (runId, proposalId) => {
      expect([runId, proposalId]).toEqual([proposal.runId, proposal.id]);
      return proposal;
    }).execute(request, contextWith(true));
    expect(bridge.requests[0]?.options.candidate).toEqual({
      proposalId: proposal.id, revision: 4, commands: proposal.commands,
    });
    await expect(tool(bridge, () => ({ ...proposal, status: "applied" }))
      .execute(request, contextWith(true))).rejects.toThrow("Only a pending proposal");
    expect(bridge.requests).toHaveLength(1);
  });
  it("is a read-only tool that never needs approval", async () => {
    const definition = tool(new RecordingBridge());
    expect(definition.name).toBe("viewport.capture");
    expect(definition.permission).toBe("read");
    await expect(definition.requiresApproval({ views: [{ preset: "front" }] }, contextWith(true))).resolves.toBe(false);
  });

  it("returns the measurements as text and each picture as an image part", async () => {
    const bridge = new RecordingBridge();
    const result = await tool(bridge).execute({ views: [{ preset: "front" }, { preset: "top" }], focus: ["torso"] }, contextWith(true));

    expect(bridge.requests[0]?.options).toMatchObject({ withImages: true, captureId: expect.stringMatching(/^cap_/) as unknown });
    expect(result).toBeInstanceOf(RichToolResult);
    if (!(result instanceof RichToolResult)) return;
    const parts = result.parts();
    expect(parts.map((part) => part.type)).toEqual(["text", "image", "image"]);
    const text = JSON.parse(result.text) as { views: { image: number; label: string; data?: string }[]; focus: { id: string }[] };
    expect(text.views.map((view) => view.label)).toEqual(["front", "top"]);
    // The pixels travel as image parts only, never inside the text the model reads first.
    expect(JSON.stringify(text)).not.toContain("AAAA");
    expect(text.focus[0]?.id).toBe("torso");
    expect(parts[1]).toEqual({ type: "image", image: { data: "AAAA", mediaType: "image/jpeg" } });
  });

  it("tells the chat which views were drawn, under the id the editor filed the pictures with, without the pictures", async () => {
    const bridge = new RecordingBridge();
    await tool(bridge).execute({ views: [{ preset: "front" }, { preset: "top" }] }, contextWith(true));

    const captureId = bridge.requests[0]?.options.captureId;
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toEqual({
      type: "viewport.captured",
      payload: {
        captureId,
        views: [
          { label: "front", width: 768, height: 576 },
          { label: "top", width: 768, height: 576 },
        ],
        imagesSent: true,
      },
    });
    // Pictures never travel in run events, which are stored and replayed.
    expect(JSON.stringify(emitted)).not.toContain("AAAA");
  });

  it("says no images were sent when the model cannot take them", async () => {
    const bridge = new RecordingBridge();
    bridge.result = { ...captured, images: captured.images.map((image) => ({ ...image, data: "" })) };
    await tool(bridge).execute({ views: [{ preset: "front" }] }, contextWith(false));

    expect(emitted[0]?.payload).toMatchObject({ imagesSent: false });
  });

  it("asks the editor not to draw, and returns text only, when the model cannot take images", async () => {
    const bridge = new RecordingBridge();
    bridge.result = { ...captured, images: captured.images.map((image) => ({ ...image, data: "" })) };
    const result = await tool(bridge).execute({ views: [{ preset: "front" }] }, contextWith(false));

    expect(bridge.requests[0]?.options).toMatchObject({ withImages: false });
    expect(result).not.toBeInstanceOf(RichToolResult);
    expect(JSON.stringify(result)).toContain("cannot receive images");
    expect(JSON.stringify(result)).toContain("screenBounds");
  });

  it("does not claim images were sent when the editor drew none", async () => {
    const bridge = new RecordingBridge();
    bridge.result = { ...captured, images: captured.images.map((image) => ({ ...image, data: "" })) };
    const result = await tool(bridge).execute({ views: [{ preset: "front" }] }, contextWith(true));

    expect(result).not.toBeInstanceOf(RichToolResult);
    expect(JSON.stringify(result)).toContain("cannot receive images");
  });

  it("rejects requests with no views, too many views, or unknown fields", () => {
    const { parameters } = tool(new RecordingBridge());
    expect(parameters.safeParse({ views: [] }).success).toBe(false);
    expect(parameters.safeParse({ views: Array.from({ length: 7 }, () => ({ preset: "front" })) }).success).toBe(false);
    expect(parameters.safeParse({ views: [{ preset: "sideways" }] }).success).toBe(false);
    expect(parameters.safeParse({ views: [{ preset: "front" }], width: 4000 }).success).toBe(false);
    expect(parameters.safeParse({ views: [{ preset: "front" }], extra: true }).success).toBe(false);
    expect(parameters.safeParse({ views: [{ orbit: { azimuthDegrees: 45, elevationDegrees: 30 } }], mode: "normals" }).success).toBe(true);
    expect(parameters.safeParse({ views: [{ camera: { position: [4, 3, 6], target: [0, 1, 0], fov: 30 } }] }).success).toBe(true);
  });
});
