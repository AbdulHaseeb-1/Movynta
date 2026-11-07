import { Box3, SkinnedMesh, type Mesh } from "three";
import type { EditorScene } from "@/features/assistant";
import { meshAtPath, modifierStack } from "@/features/meshGeometry";
import { resolveBisectPlane } from "@/features/meshGeometry/bisectPlane";
import { bisectMesh, type BisectKeep } from "@/features/meshGeometry/meshBisect";
import { readTopology } from "@/features/meshGeometry/meshTopology";
import { saveCageEdit, type CageEdit } from "./saveCageEdit";
import type { ComponentChoice } from "./subdivideSelection";
import type { ComponentKind } from "./workspaceSlice";

export type CutAxis = "x" | "y" | "z";
/** A plane cut chosen in the dialog. The plane is in world space, so it follows the object's transform. */
export interface CutSpec {
  axis: CutAxis;
  offset: number;
  keep: BisectKeep;
  fill: boolean;
  facesOnly: boolean;
}

/** What an Edit-mode Mesh menu item asks for, besides the cleanup tools. */
export type MeshToolAction =
  | { type: "delete"; kind: ComponentKind }
  | { type: "separate" }
  | { type: "flip" }
  | { type: "triangulate" }
  | { type: "bridge"; twist?: number }
  | { type: "shade"; mode: "flat" | "smooth"; angle?: number }
  | { type: "cut"; spec: CutSpec };

interface Target {
  mesh: Mesh;
  modifiers: ReturnType<typeof modifierStack>;
}

/** Checks the scene still matches the selection and that the mesh may be edited, the way every cage edit does. */
function target(scene: EditorScene, choice: ComponentChoice, revision: number, allowEnabledModifiers: boolean): Target {
  if (scene.currentRevision !== revision)
    throw new Error("The mesh changed. Select the components again before editing.");
  const mesh = meshAtPath(scene.getObject(choice.objectId), choice.meshPath);
  if (mesh instanceof SkinnedMesh) throw new Error("Component edits on skinned meshes are not supported yet.");
  const modifiers = modifierStack(mesh);
  if (!allowEnabledModifiers && modifiers?.modifiers.some((entry) => entry.enabled))
    throw new Error("Disable modifiers before editing the base mesh.");
  if (!allowEnabledModifiers && modifiers?.modifiers.some((entry) => entry.kind === "extrusion"))
    throw new Error("Remove the live extrusion before changing mesh topology.");
  return { mesh, modifiers };
}

/** The edit a menu item stands for, and what stays selected afterward: component numbers that survive keep their selection. */
export function meshToolEdit(action: MeshToolAction, choice: ComponentChoice): { edit: CageEdit; selection: string[] } {
  const ids = [...choice.ids];
  switch (action.type) {
    case "delete":
      return { edit: { type: "geometry.delete_components", kind: action.kind, ids }, selection: [] };
    case "separate":
      return {
        edit: { type: "geometry.separate_faces", ids, newObjectId: `part_${crypto.randomUUID()}` },
        selection: [],
      };
    case "flip":
      return { edit: { type: "geometry.flip_normals", ids }, selection: ids };
    case "triangulate":
      return { edit: { type: "geometry.triangulate_faces", ids }, selection: [] };
    case "bridge":
      return {
        edit: { type: "geometry.bridge_edge_loops", ids, ...(action.twist ? { twist: action.twist } : {}) },
        selection: [],
      };
    case "shade":
      return {
        edit: {
          type: "geometry.set_shading",
          mode: action.mode,
          ...(action.angle === undefined ? {} : { angle: action.angle }),
        },
        selection: ids,
      };
    case "cut": {
      const { axis, offset, keep, fill, facesOnly } = action.spec;
      return {
        edit: {
          type: "geometry.bisect",
          plane: { axis, offset },
          space: "world",
          keep,
          fill: keep !== "both" && fill,
          ...(facesOnly && keep === "both" ? { ids } : {}),
        },
        selection: [],
      };
    }
    default: {
      const unknown: never = action;
      throw new Error(`Unknown mesh tool ${JSON.stringify(unknown)}`);
    }
  }
}

/** Called inside the save queue; the IDs must still name the cage the user selected. */
export async function applyMeshTool(
  scene: EditorScene,
  choice: ComponentChoice,
  revision: number,
  action: MeshToolAction,
): Promise<void> {
  // Shading needs no component IDs, so it also works while modifiers show the evaluated mesh.
  target(scene, choice, revision, action.type === "shade");
  const { edit, selection } = meshToolEdit(action, choice);
  await saveCageEdit(scene, { ...choice, revision, selection, edit });
}

/** Where the object is along an axis in the world: the middle of its bounds, a sensible first place to cut. */
export function middleOfObject(scene: EditorScene, choice: ComponentChoice, axis: CutAxis): number {
  const mesh = meshAtPath(scene.getObject(choice.objectId), choice.meshPath);
  mesh.updateWorldMatrix(true, false);
  const box = new Box3().setFromObject(mesh);
  if (box.isEmpty()) return 0;
  const middle = box.getCenter(box.min.clone())[axis];
  return Number(middle.toPrecision(6));
}

export interface CutPreview {
  ok: boolean;
  message: string;
  split: number;
  removed: number;
  capped: number;
}

/** Works the cut out on the current cage without saving, so the dialog can say what it would do or why it cannot. */
export function previewMeshCut(
  scene: EditorScene,
  choice: ComponentChoice,
  revision: number,
  spec: CutSpec,
): CutPreview {
  const none = { split: 0, removed: 0, capped: 0 };
  try {
    if (!Number.isFinite(spec.offset)) throw new Error("Enter a number for the position of the plane.");
    const { mesh } = target(scene, choice, revision, false);
    mesh.updateWorldMatrix(true, false);
    const plane = resolveBisectPlane({ axis: spec.axis, offset: spec.offset }, "world", mesh.matrixWorld);
    const faces = spec.facesOnly && spec.keep === "both" ? new Set(choice.ids.map(Number)) : undefined;
    const result = bisectMesh(readTopology(mesh.geometry), mesh.geometry, plane, {
      keep: spec.keep,
      fill: spec.keep !== "both" && spec.fill,
      ...(faces ? { faces } : {}),
    });
    const parts = [`cuts ${result.split} face${result.split === 1 ? "" : "s"}`];
    if (result.removed) parts.push(`removes ${result.removed}`);
    if (result.capped) parts.push(`adds ${result.capped} cap face${result.capped === 1 ? "" : "s"}`);
    return {
      ok: true,
      message: `This ${parts.join(", ")}.`,
      split: result.split,
      removed: result.removed,
      capped: result.capped,
    };
  } catch (error) {
    return { ...none, ok: false, message: error instanceof Error ? error.message : "The cut cannot be made." };
  }
}
