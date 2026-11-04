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

  issues.push(...structureIssues(scene));

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

/** Scales that differ on different axes by more than rounding: the case that cannot keep a turned child exact. */
function unevenScale([sx, sy, sz]: readonly [number, number, number]): boolean {
  const limit = 1e-4 * Math.max(Math.abs(sx), Math.abs(sy), Math.abs(sz), 1e-12);
  return Math.abs(Math.abs(sx) - Math.abs(sy)) > limit || Math.abs(Math.abs(sy) - Math.abs(sz)) > limit;
}

/** How the objects are arranged: shared names, groups that cannot take a turned child exactly, and empty groups. */
function structureIssues(scene: EditorContext): SceneIssue[] {
  const issues: SceneIssue[] = [];
  const hasChildren = new Set<string>();
  const names = new Set<string>();
  for (const object of scene.objects) {
    if (object.parentId !== null) hasChildren.add(object.parentId);
    const key = `${object.parentId ?? ""}\u0000${object.name}`;
    if (object.name.length > 0 && names.has(key)) {
      issues.push({ severity: "warning", objectId: object.id, message: `Shares the name "${object.name}" with another object under the same parent; rename one so each can be told apart` });
    }
    names.add(key);
  }
  for (const object of scene.objects) {
    if (hasChildren.has(object.id) && unevenScale(object.transform.scale)) {
      issues.push({
        severity: "warning",
        objectId: object.id,
        message: "Has children and is scaled by different amounts on different axes, so a turned child cannot be moved under it or out of it and stay where it is. Give it the same scale on every axis and scale the parts instead",
      });
    }
    if (object.type === "empty" && !hasChildren.has(object.id)) {
      issues.push({ severity: "info", objectId: object.id, message: "Group has no children" });
    }
  }
  return issues;
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
      description: "Check the current scene for duplicate ids, missing parents, parent cycles, and invalid scale (errors), names shared by objects under one parent and groups scaled unevenly (warnings), and empty groups (information).",
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
