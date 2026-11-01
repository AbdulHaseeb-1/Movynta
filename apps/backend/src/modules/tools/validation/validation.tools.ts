import { z } from "zod";
import type { EditorBridge } from "../../editor-bridge/editor-bridge.types.js";
import type { EditorContext } from "../../../shared/types/editor-context.types.js";
import { defineTool, type ToolDefinition } from "../tool.types.js";
import type { SceneCheckResult, SceneIssue } from "./validation.types.js";

export const LARGE_SCENE_WARNING_THRESHOLD = 500;

/** Pure checks over an editor snapshot. Used by the tool and by unit tests. */
export function checkScene(scene: EditorContext): SceneCheckResult {
  const issues: SceneIssue[] = [];
  const byId = new Map<string, EditorContext["objects"][number]>();

  for (const object of scene.objects) {
    if (byId.has(object.id)) {
      issues.push({ severity: "error", objectId: object.id, message: "Duplicate object id" });
    }
    byId.set(object.id, object);
    if (object.transform.scale.some((axis) => axis <= 0)) {
      issues.push({ severity: "error", objectId: object.id, message: "Scale must be positive on every axis" });
    }
  }

  for (const object of scene.objects) {
    if (object.parentId !== null && !byId.has(object.parentId)) {
      issues.push({ severity: "error", objectId: object.id, message: "Parent does not exist" });
    }
    if (hasParentCycle(object.id, byId)) {
      issues.push({ severity: "error", objectId: object.id, message: "Parent chain contains a cycle" });
    }
  }

  for (const selected of scene.selectedObjectIds) {
    if (!byId.has(selected)) {
      issues.push({ severity: "warning", objectId: selected, message: "Selected object is not in the scene" });
    }
  }

  if (scene.objects.length > LARGE_SCENE_WARNING_THRESHOLD) {
    issues.push({ severity: "warning", objectId: null, message: "Scene is large; checks may be slow to review" });
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    objectCount: scene.objects.length,
    issues,
  };
}

function hasParentCycle(startId: string, byId: ReadonlyMap<string, EditorContext["objects"][number]>): boolean {
  const visited = new Set<string>();
  let current = byId.get(startId);
  while (current?.parentId) {
    if (visited.has(current.id)) return true;
    visited.add(current.id);
    current = byId.get(current.parentId);
  }
  return false;
}

export function createValidationTools({ bridge }: { readonly bridge: EditorBridge }): ToolDefinition[] {
  return [
    defineTool({
      name: "validation.check_scene",
      description: "Check the current scene for duplicate ids, missing parents, parent cycles, and invalid scale.",
      permission: "read",
      parameters: z.object({}).strict(),
      execute: async (_input, context) => {
        bridge.assertConnection(context.userId, context.projectId, context.clientId);
        const scene = await bridge.getContext(context.clientId);
        return checkScene(scene);
      },
    }),
  ];
}
