import { z } from "zod";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import { briefBlocksReady } from "../../agent-runs/run-progress.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";

export const QUALITY_ASSESS_TOOL_NAME = "modeling.assess_quality";

/**
 * Tools only the independent reviewer may call. The assistant that builds is not given them, so it cannot grade its
 * own work: the verdict that lets a run finish comes from a separate agent that did not build the result.
 */
export const REVIEWER_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([QUALITY_ASSESS_TOOL_NAME]);

/**
 * Records the reviewer's verdict on the finished work. It is a fallible judgment, not an objective measurement, but it is
 * made by an agent with fresh eyes, and the evidence rules below stop it from approving what it did not look at.
 */
export function createQualityTools(bridge: EditorBridge): ToolDefinition[] {
  return [
    defineTool({
      name: QUALITY_ASSESS_TOOL_NAME,
      description: [
        "Record your verdict on the finished work. Call it once, last.",
        "ready: no major defect remains. It needs pictures of at least two distinct live solid views taken at the current scene (viewport.capture), observations on at least two different aspects, and no major finding.",
        "needs_refinement: at least one major defect remains that the builder should fix. Each finding says what is wrong, how serious it is, and what to change (fix). With pictures available, look at the scene first; without them, findings may rest on measurements.",
        "blocked: you cannot judge, for example because pictures are unavailable and nothing measurable settles the question. Say what could not be checked; never claim to have seen what you did not.",
        "Major means the result fails the request: a missing or floating part, wrong proportions, wrong scale, a broken silhouette. Minor means polish.",
      ].join(" "),
      permission: "plan",
      parameters: z
        .object({
          outcome: z.enum(["ready", "needs_refinement", "blocked"]),
          summary: z.string().trim().min(1).max(600),
          findings: z
            .array(
              z
                .object({
                  aspect: z.string().trim().min(1).max(80),
                  observation: z.string().trim().min(1).max(300),
                  severity: z.enum(["major", "minor"]),
                  fix: z.string().trim().min(1).max(240).optional(),
                })
                .strict(),
            )
            .max(8),
        })
        .strict(),
      execute: async (input, context) => {
        bridge.assertConnection(context.userId, context.projectId, context.clientId);
        const quality = context.progress.quality;
        if (!quality.changes)
          return { status: "rejected", reason: "Apply scene changes before recording the final quality review." };

        // What the reviewer actually looked at, judged against the scene as it is now.
        const forgetCaptures = () => {
          quality.captureRevision = null;
          quality.viewpoints = [];
          quality.outcome = null;
          quality.summary = "";
          quality.findings = [];
        };
        let evidence: "visual" | "measurements" | "not required" = "not required";
        // Pictures are possible when the model can take them and the viewport can draw them.
        const canSee = context.supportsToolImages && !quality.viewportUnavailable;
        if (input.outcome !== "blocked") {
          const scene = await bridge.getContext(context.clientId);
          const looked = quality.captureRevision !== null && quality.viewpoints.length > 0;
          if (looked && scene.revision !== quality.captureRevision) {
            forgetCaptures();
            return {
              status: "rejected",
              reason: "The scene changed after the captures. Capture fresh views before reviewing.",
            };
          }
          if (input.outcome === "ready") {
            if (!canSee || !looked || quality.viewpoints.length < 2)
              return {
                status: "rejected",
                reason:
                  "A ready verdict needs pictures of at least two distinct live solid views taken after the latest change. If pictures are unavailable, record blocked and say the result was not visually verified.",
              };
            evidence = "visual";
          } else if (canSee) {
            // Pictures are possible, so a verdict that finds fault must come from having looked.
            if (!looked)
              return {
                status: "rejected",
                reason:
                  "Look at the scene with viewport.capture before reporting problems, so findings come from the result and not from the request.",
              };
            evidence = "visual";
          } else {
            evidence = "measurements";
          }
        }
        if (input.outcome === "ready") {
          // Measured checks come before opinion: a result that fails its own brief is not ready, however it looks.
          const blocked = briefBlocksReady(context.progress);
          if (blocked) return { status: "rejected", reason: blocked };
          if (input.findings.some((finding) => finding.severity === "major"))
            return { status: "rejected", reason: "A review with major unresolved findings cannot be marked ready." };
          if (new Set(input.findings.map((finding) => finding.aspect.toLowerCase())).size < 2)
            return {
              status: "rejected",
              reason: "Describe observations for at least two distinct aspects before marking the result ready.",
            };
        }
        if (input.outcome !== "ready" && input.findings.length === 0)
          return { status: "rejected", reason: "Describe at least one concrete finding or blocker." };
        if (input.outcome === "needs_refinement" && !input.findings.some((finding) => finding.severity === "major"))
          return {
            status: "rejected",
            reason:
              "needs_refinement means a major defect remains. If only minor polish is left, record ready with those notes as minor findings.",
          };

        quality.outcome = input.outcome;
        quality.summary = input.summary;
        quality.findings = input.findings.map((finding) => ({
          aspect: finding.aspect,
          observation: finding.observation,
          severity: finding.severity,
          ...(finding.fix ? { fix: finding.fix } : {}),
        }));
        return {
          status: "recorded",
          outcome: input.outcome,
          summary: input.summary,
          findingCount: input.findings.length,
          evidence,
        };
      },
    }),
  ];
}
