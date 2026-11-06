import { edgeKey } from "@/features/meshGeometry/meshTopology";
import type { ComponentGeometry } from "./componentGeometry";
import type { ComponentKind } from "./workspaceSlice";

export type ComponentSelectionOperation = "grow" | "shrink" | "connected" | "loop" | "ring";

/** Vertices meet through an edge, edges through a vertex, and faces through an edge. */
export function changeComponentSelection(data: ComponentGeometry, kind: ComponentKind, selected: readonly string[], operation: ComponentSelectionOperation): string[] {
  const groups = new Map<string, string[]>();
  const keysById = new Map<string, string[]>();
  const add = (id: string, keys: readonly string[]) => {
    keysById.set(id, [...keys]);
    for (const key of keys) {
      const group = groups.get(key);
      if (group) group.push(id); else groups.set(key, [id]);
    }
  };
  if (kind === "vertex") {
    data.mesh.positions.forEach((_, index) => keysById.set(String(index), []));
    for (const [key, [a, b]] of data.edges) {
      groups.set(key, [String(a), String(b)]);
      keysById.get(String(a))?.push(key);
      keysById.get(String(b))?.push(key);
    }
  } else if (kind === "edge") {
    for (const [id, [a, b]] of data.edges) add(id, [String(a), String(b)]);
  } else {
    data.mesh.faces.forEach((face, index) => add(String(index), face.flatMap((a, i) => {
      const b = face[(i + 1) % face.length];
      return b === undefined ? [] : [edgeKey(a, b)];
    })));
  }
  const result = new Set(selected.filter((id) => keysById.has(id)));
  if (operation === "shrink") {
    const incomplete = new Set<string>();
    for (const [key, ids] of groups) if (ids.some((id) => !result.has(id))) incomplete.add(key);
    return [...result].filter((id) => (keysById.get(id) ?? []).every((key) => !incomplete.has(key)));
  }
  const queue = [...result];
  const visitedGroups = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    if (id === undefined) continue;
    for (const key of keysById.get(id) ?? []) {
      if (visitedGroups.has(key)) continue;
      visitedGroups.add(key);
      for (const neighbor of groups.get(key) ?? []) if (!result.has(neighbor)) {
        result.add(neighbor);
        if (operation === "connected") queue.push(neighbor);
      }
    }
  }
  return [...result];
}
