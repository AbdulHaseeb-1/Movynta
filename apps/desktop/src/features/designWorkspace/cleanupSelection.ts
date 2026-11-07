import { SkinnedMesh } from "three";
import type { EditorScene } from "@/features/assistant";
import { meshAtPath, modifierStack } from "@/features/meshGeometry";
import { readTopology } from "@/features/meshGeometry/meshTopology";
import { mergeVertices } from "@/features/meshGeometry/meshMerge";
import { dissolveEdges } from "@/features/meshGeometry/meshDissolve";
import { fillHole } from "@/features/meshGeometry/meshFillHole";
import { saveCageEdit, type CageEdit } from "./saveCageEdit";
import type { ComponentChoice } from "./subdivideSelection";

export type CleanupAction = "merge-center" | "merge-first" | "merge-last" | "dissolve" | "fill";

/** Called inside the save queue; the IDs must still name the cage the user selected. */
export async function cleanupSelection(
  scene: EditorScene,
  choice: ComponentChoice,
  revision: number,
  action: CleanupAction,
): Promise<void> {
  if (scene.currentRevision !== revision)
    throw new Error("The mesh changed. Select the components again before editing.");
  const mesh = meshAtPath(scene.getObject(choice.objectId), choice.meshPath);
  if (mesh instanceof SkinnedMesh) throw new Error("Component edits on skinned meshes are not supported yet.");
  const modifiers = modifierStack(mesh)?.modifiers ?? [];
  if (modifiers.some((entry) => entry.enabled)) throw new Error("Disable modifiers before editing the base mesh.");
  if (modifiers.some((entry) => entry.kind === "extrusion"))
    throw new Error("Remove the live extrusion before changing mesh topology.");
  const cage = readTopology(mesh.geometry);
  const ids = [...choice.ids];
  let edit: CageEdit;
  let selection: string[];
  if (action === "fill") {
    edit = { type: "geometry.fill_hole", ids };
    // The result contains face IDs; clear the edge selection rather than reusing renumbered IDs.
    fillHole(cage, ids);
    selection = [];
  } else if (action === "dissolve") {
    edit = { type: "geometry.dissolve_edges", ids };
    dissolveEdges(cage, ids, mesh.geometry);
    selection = [];
  } else {
    const mode = action === "merge-center" ? "center" : action === "merge-first" ? "first" : "last";
    edit = { type: "geometry.merge_vertices", ids, mode };
    selection = mergeVertices(cage, ids, mode).selection;
  }
  await saveCageEdit(scene, { ...choice, revision, selection, edit });
}
