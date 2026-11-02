import { z } from "zod";
import { backendRequest } from "@/lib/backend";

/** Saves a change the user made by hand with the project, so it is there when the project is reopened. */
export function recordSceneEdit(
  projectId: string,
  commands: readonly unknown[],
): Promise<{ proposalId: string }> {
  return backendRequest(
    `/projects/${projectId}/scene/edits`,
    z.object({ proposalId: z.string() }),
    "POST",
    { commands },
  );
}
