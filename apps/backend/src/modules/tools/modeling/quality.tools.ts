import { z } from "zod";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import { briefBlocksReady } from "../../agent-runs/run-progress.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";

export const QUALITY_ASSESS_TOOL_NAME = "modeling.assess_quality";

/** Records the model's review; it is not an independent or objective visual-quality measurement. */
export function createQualityTools(bridge: EditorBridge): ToolDefinition[] {
  return [defineTool({
    name: QUALITY_ASSESS_TOOL_NAME,
    description: "Record an honest task-specific quality review of the current scene. After applying changes, inspect at least two distinct live solid viewport captures before choosing ready or needs_refinement. List concrete visible findings and distinguish remaining major defects from minor details. If images or necessary capabilities are unavailable, choose blocked and explain what remains; never claim visual verification without images. A needs_refinement result requires another applied change and fresh review before ready.",
    permission: "plan",
    parameters: z.object({
      outcome: z.enum(["ready", "needs_refinement", "blocked"]),
      summary: z.string().trim().min(1).max(600),
      findings: z.array(z.object({
        aspect: z.string().trim().min(1).max(80),
        observation: z.string().trim().min(1).max(300),
        severity: z.enum(["major", "minor"]),
      }).strict()).max(8),
    }).strict(),
    execute: async (input, context) => {
      bridge.assertConnection(context.userId, context.projectId, context.clientId);
      const quality = context.progress.quality;
      if (!quality.changes) return { status: "rejected", reason: "Apply scene changes before recording the final quality review." };
      if (input.outcome !== "blocked") {
        if (!context.supportsToolImages || quality.captureRevision === null || quality.viewpoints.length < 2)
          return { status: "rejected", reason: "Capture at least two distinct live solid views with images after the latest change, or record a concrete blocker." };
        const scene = await bridge.getContext(context.clientId);
        if (scene.revision !== quality.captureRevision) {
          quality.captureRevision = null;
          quality.viewpoints = [];
          quality.outcome = null;
          quality.summary = "";
          return { status: "rejected", reason: "The scene changed after the captures. Capture fresh views before reviewing." };
        }
        if (quality.outcome === "needs_refinement" && input.outcome === "ready")
          return { status: "rejected", reason: "The previous review requested refinement. Apply a targeted change and capture fresh views, or record a blocker." };
      }
      if (input.outcome === "ready") {
        // Measured checks come before opinion: a result that fails its own brief is not ready, however it looks.
        const blocked = briefBlocksReady(context.progress);
        if (blocked) return { status: "rejected", reason: blocked };
      }
      if (input.outcome === "ready" && input.findings.some((finding) => finding.severity === "major"))
        return { status: "rejected", reason: "A review with major unresolved findings cannot be marked ready." };
      if (input.outcome === "ready" && new Set(input.findings.map((finding) => finding.aspect.toLowerCase())).size < 2)
        return { status: "rejected", reason: "Describe observations for at least two distinct aspects before marking the result ready." };
      if (input.outcome !== "ready" && input.findings.length === 0)
        return { status: "rejected", reason: "Describe at least one concrete finding or blocker." };
      quality.outcome = input.outcome;
      quality.summary = input.summary;
      return { status: "recorded", outcome: input.outcome, summary: input.summary, findingCount: input.findings.length, evidence: input.outcome === "blocked" ? "not required" : "visual" };
    },
  })];
}
