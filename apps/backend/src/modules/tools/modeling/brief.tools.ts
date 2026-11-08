import { z } from "zod";
import { briefPassed, briefSchema, evaluateBrief } from "@movynta/editor-protocol";
import { summarizeEvaluation } from "../../agent-runs/run-progress.js";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";

/** The name of the tool that records a brief. */
export const BRIEF_RECORD_TOOL_NAME = "modeling.record_brief";
/** The name of the tool that checks a brief against the scene. */
export const BRIEF_CHECK_TOOL_NAME = "validation.check_brief";

/**
 * The brief is what "done" means, written before building and measured by code afterward. Recording it changes
 * nothing in the scene; checking it reads the scene and reports each check as pass, fail or unresolved.
 */
export function createBriefTools(bridge: EditorBridge): ToolDefinition[] {
  return [
    defineTool({
      name: BRIEF_RECORD_TOOL_NAME,
      description: [
        "Record the brief for this request: the subject, the assumptions you make where the user gave no detail, and measurable checks that decide when the work is right.",
        "Call it once, after reading the scene and before the plan, for any request that builds or reshapes something.",
        "Checks are measured on world-space bounds in scene units, and a group's bounds include its parts, so name the whole thing by its group.",
        "Kinds: count (how many objects match; selector may use namePrefix), size (extent on an axis), position (min, center or max on an axis, such as the lowest point on the floor),",
        "gap (from the high edge of first to the low edge of second on an axis; 0 means touching, negative means overlapping), symmetric (second mirrors first across a plane), aligned (same center on an axis), contained (inner lies inside outer),",
        "connected (every part under a group touches the rest, so nothing floats; name the group).",
        "Name objects by exact name or id; the objects need not exist yet. Write checks for what makes this subject right: real proportions, parts resting on what carries them, left and right matching, details inside their parent.",
        "Recording again replaces the brief and is disclosed to the user, so change a check only when it was wrong.",
        "It does not change the scene.",
      ].join(" "),
      permission: "plan",
      parameters: briefSchema,
      execute: (brief, context) => {
        const state = context.progress.brief;
        const replaced = state.current !== null;
        if (replaced) state.revisions += 1;
        const hadFailures = (state.last?.failing.length ?? 0) > 0;
        state.current = brief;
        state.stale = true;
        state.last = null;
        return {
          status: "recorded",
          checkCount: brief.checks.length,
          replaced,
          ...(replaced && hadFailures
            ? {
                warning:
                  "The previous brief had failing checks. Keep a check only if it still describes the right result; weakening a check to pass is disclosed to the user.",
              }
            : {}),
          next: "Build the model, then call validation.check_brief after the changes are applied.",
        };
      },
    }),
    defineTool({
      name: BRIEF_CHECK_TOOL_NAME,
      description: [
        "Measure the recorded brief against the current scene. Each check is pass, fail or unresolved (an object is missing, ambiguous or has no geometry yet), with what was measured and what was needed.",
        "Run it after applying changes; fix the model for every fail and unresolved check, then run it again. The run is not finished while checks fail.",
        "Passing checks prove sizes, placement and symmetry only. They do not judge shape or appearance, so still look at the scene with viewport.capture.",
        "It does not change the scene.",
      ].join(" "),
      permission: "read",
      parameters: z.object({}).strict(),
      execute: async (_input, context) => {
        const state = context.progress.brief;
        if (state.current === null)
          return { status: "rejected", reason: "No brief is recorded. Call modeling.record_brief first." };
        bridge.assertConnection(context.userId, context.projectId, context.clientId);
        const evaluation = evaluateBrief(await bridge.getContext(context.clientId), state.current);
        state.stale = false;
        state.last = summarizeEvaluation(evaluation);
        const passed = briefPassed(evaluation);
        return {
          status: passed ? "pass" : evaluation.measurable ? "fail" : "unmeasurable",
          revision: evaluation.revision,
          passed: evaluation.passed,
          failed: evaluation.failed,
          unresolved: evaluation.unresolved,
          results: evaluation.results,
          ...(evaluation.measurable
            ? {}
            : {
                message:
                  "The editor did not report object bounds, so these checks cannot be measured. Say so in your reply instead of claiming they pass.",
              }),
        };
      },
    }),
  ];
}
