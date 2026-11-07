import { z } from "zod";
import { readStored, removeStored, writeStored } from "@/lib/storage";
import type { ComponentKind } from "./workspaceSlice";

const schema = z
  .object({
    objectId: z.string().min(1).max(64),
    kind: z.enum(["vertex", "edge", "face"]),
    path: z.array(z.number().int().nonnegative()).max(32),
    ids: z.array(z.string().regex(/^\d{1,10}(_\d{1,10})?$/)).max(4096),
    key: z.string().regex(/^[0-9a-f]{16}$/),
  })
  .strict();
export interface StoredComponentSelection {
  objectId: string;
  kind: ComponentKind;
  path: number[];
  ids: string[];
  key: string;
}
const storageKey = (projectId: string) => `movynta.project.selection.v1.${projectId}`;
/** The component selection saved for a project, or null when none is saved. */
export function loadComponentSelection(projectId: string): StoredComponentSelection | null {
  return readStored(storageKey(projectId), schema) ?? null;
}
/** Saves the component selection for a project, or forgets it when given null. */
export function saveComponentSelection(projectId: string, value: StoredComponentSelection | null): void {
  if (value) writeStored(storageKey(projectId), value);
  else removeStored(storageKey(projectId));
}
