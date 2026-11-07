import { viewCaptureRequestSchema, type CapturedImage, type ViewCaptureResult } from "@movynta/editor-protocol";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import type { CommandProposalService } from "../../editor-bridge/proposals/command-proposal.service.js";
import { ConflictError } from "../../../common/errors/app-error.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";
import { RichToolResult } from "../tool-result.js";
import { newId } from "../../../common/ids/index.js";

export const VIEWPORT_CAPTURE_TOOL_NAME = "viewport.capture";

const AXES_NOTE =
  "Y is up. A front view looks along -Z (it sees the +Z side), a right view looks along -X, a left view looks along +X, a back view looks along +Z.";

/** The image without its pixels, so the text part stays small and the model reads the measurements first. */
function describeImage(image: CapturedImage, index: number) {
  return {
    image: index + 1,
    label: image.label,
    width: image.width,
    height: image.height,
    camera: image.camera,
    objects: image.objects,
  };
}

/** What the model reads next to the pictures: how each was taken and where every object is in it. */
function describeCapture(result: ViewCaptureResult, imagesSent: boolean) {
  return {
    status: "ok",
    coordinates: AXES_NOTE,
    scene: result.scene,
    focus: result.focus,
    missingIds: result.missingIds,
    views: result.images.map(describeImage),
    note: imagesSent
      ? "The images follow in the order of views. screenBounds is each object's projected bounding box in pixels, not a visibility test."
      : "This model connection cannot receive images, so none were drawn. The bounds, sizes and screenBounds above are still exact.",
  };
}

export function createViewportTools({ bridge, proposals }: {
  readonly bridge: EditorBridge;
  readonly proposals: Pick<CommandProposalService, "require">;
}): ToolDefinition[] {
  return [
    defineTool({
      name: VIEWPORT_CAPTURE_TOOL_NAME,
      description: [
        "Look at the scene. Draws the live editor scene from one or more points of view and returns the images, plus where each object sits in every image, so you can review shapes, proportions, placement and surface problems that the object list cannot show. Nothing in the scene changes.",
        "To review an unapplied proposal from this run, pass its proposalId. The editor validates and draws an isolated candidate at that proposal's revision. Capture the live scene and the candidate with matching cameras to compare them before asking for approval.",
        "views: 1 to 6 per call. Each view is a preset (front, back, left, right, top, bottom, isometric, or current for the user's own view), an orbit (azimuthDegrees: 0 looks at the front from +Z, 90 from +X, 180 from the back; elevationDegrees: 0 is level, 90 is straight down), or an exact camera (position, target, optional fov). Y is up.",
        "Presets and orbits circle and frame the focused objects, or the whole scene when focus is empty; zoom above 1 moves closer. Axis presets are orthographic so proportions are true; set projection to change that.",
        "focus lists the object ids to frame and report exact bounds for. highlight boxes objects in the image. isolate true draws only the focused objects. mode is solid (default), wireframe (mesh structure) or normals (surface direction, which shows flipped or faceted faces).",
        "labels (default true) writes object ids in the image. guides (default true) draws a floor grid and axes for scale. width and height are pixels, 128 to 1024.",
        "Work in steps: take a few overview views first, then zoom into anything suspicious with a focus and a higher zoom or a custom camera. Images are not kept in the conversation history, so state what you concluded in your reply.",
      ].join(" "),
      permission: "read",
      parameters: viewCaptureRequestSchema,
      execute: async (request, context) => {
        bridge.assertConnection(context.userId, context.projectId, context.clientId);
        const withImages = context.supportsToolImages;
        // The editor files the pictures it draws under this id, and the chat finds them there to show the user.
        const captureId = newId("cap");
        const proposal = request.proposalId ? proposals.require(context.runId, request.proposalId) : undefined;
        if (proposal && (proposal.status !== "proposed" || proposal.clientId !== context.clientId || proposal.projectId !== context.projectId)) {
          throw new ConflictError("Only a pending proposal for this editor can be previewed.");
        }
        const candidate = proposal
          ? { proposalId: proposal.id, revision: proposal.baseRevision, commands: proposal.commands }
          : undefined;
        // A quality review needs live image evidence from one unchanged scene revision. Candidate previews and
        // measurement-only responses must never satisfy it. Other captures avoid the extra context requests.
        const trackQuality = context.progress.quality.required && context.progress.quality.changes > 0 && !candidate && withImages && (request.mode ?? "solid") === "solid";
        const before = trackQuality ? await bridge.getContext(context.clientId) : undefined;
        let result: Awaited<ReturnType<typeof bridge.captureViews>>;
        try {
          result = await bridge.captureViews(context.clientId, request, {
            withImages, captureId, ...(candidate ? { candidate } : {}),
          });
        } catch (error) {
          // A viewport that cannot draw leaves nothing to look at. The reviewer is told, not left to retry for ever.
          if (!candidate) context.progress.quality.viewportUnavailable = true;
          throw error;
        }
        if (!candidate) context.progress.quality.viewportUnavailable = false;
        const images = withImages ? result.images.filter((image) => image.data.length > 0) : [];
        if (before && images.length) {
          const after = await bridge.getContext(context.clientId);
          const quality = context.progress.quality;
          if (before.revision === after.revision) {
            if (quality.captureRevision !== after.revision) {
              quality.viewpoints = [];
              quality.outcome = null;
              quality.summary = "";
            }
            quality.captureRevision = after.revision;
            quality.viewpoints = [...new Set([...quality.viewpoints, ...images.map((image) => image.camera.position.map((n) => n.toFixed(3)).join(","))])].slice(0, 12);
          } else {
            quality.captureRevision = null;
            quality.viewpoints = [];
            quality.outcome = null;
            quality.summary = "";
          }
        }
        context.events.emit("viewport.captured", {
          captureId,
          views: result.images.map((image) => ({ label: image.label, width: image.width, height: image.height })),
          imagesSent: images.length > 0,
        });
        const description = { ...describeCapture(result, images.length > 0), ...(candidate ? { proposalId: candidate.proposalId } : {}) };
        if (images.length === 0) return description;
        return new RichToolResult(
          JSON.stringify(description),
          images.map((image) => ({ data: image.data, mediaType: image.mediaType })),
        );
      },
    }),
  ];
}
