import { z } from "zod";
import type { ComponentKind } from "./workspaceSlice";

const schema = z.object({
  objectId: z.string().min(1).max(64),
  kind: z.enum(["vertex", "edge", "face"]),
  path: z.array(z.number().int().nonnegative()).max(32),
  ids: z.array(z.string().regex(/^\d{1,10}(_\d{1,10})?$/)).max(4096),
  key: z.string().regex(/^[0-9a-f]{16}$/),
}).strict();
export interface StoredComponentSelection {
  objectId: string;
  kind: ComponentKind;
  path: number[];
  ids: string[];
  key: string;
}
const storageKey = (projectId: string) => `movynta.project.selection.v1.${projectId}`;
export function loadComponentSelection(projectId: string): StoredComponentSelection | null {
  try {
    const raw = localStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}
export function saveComponentSelection(projectId: string, value: StoredComponentSelection | null): void {
  try {
    if (value) localStorage.setItem(storageKey(projectId), JSON.stringify(value));
    else localStorage.removeItem(storageKey(projectId));
  } catch { /* Storage is optional. */ }
}
