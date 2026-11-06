import { z } from "zod";

const commandSchema = z.looseObject({
  commandId: z.string(),
  type: z.string(),
  objectId: z.string().optional(),
  name: z.string().optional(),
  parentId: z.string().optional(),
  primitive: z.string().optional(),
  size: z.number().optional(),
  width: z.number().optional(),
  thickness: z.number().optional(),
  depth: z.number().optional(),
  edge: z.string().optional(),
  cuts: z.number().optional(),
  factor: z.number().optional(),
  mode: z.string().optional(),
  slot: z.number().optional(),
  sourceId: z.string().optional(),
  copies: z.array(z.unknown()).optional(),
  outset: z.boolean().optional(),
  individual: z.boolean().optional(),
  levels: z.number().optional(),
  segments: z.number().optional(),
  method: z.string().optional(),
  profile: z.string().optional(),
  kind: z.string().optional(),
  operation: z.enum(["difference", "union", "intersect"]).optional(),
  operandObjectId: z.string().optional(),
  normalDistance: z.number().optional(),
  offset: z.array(z.number()).length(3).optional(),
  delta: z.array(z.number()).length(3).optional(),
  collectionId: z.string().nullable().optional(),
  parentCollectionId: z.string().nullable().optional(),
  visible: z.boolean().optional(),
  includeChildren: z.boolean().optional(),
  space: z.enum(["local", "world"]).optional(),
  transform: z.object({
    position: z.array(z.number()).length(3).optional(),
    rotation: z.array(z.number()).length(3).optional(),
    scale: z.array(z.number()).length(3).optional(),
  }).optional(),
  capScale: z.number().optional(),
  capScaleXY: z.array(z.number()).length(2).optional(),
  capRotationDegrees: z.array(z.number()).length(3).optional(),
  normalMode: z.enum(["region", "individual", "vertex"]).optional(),
  ids: z.array(z.string()).optional(),
  steps: z.number().optional(),
  twistDegrees: z.number().optional(),
  closeOpenSurface: z.boolean().optional(),
  modifiers: z.array(z.unknown()).optional(),
  vertices: z.array(z.unknown()).optional(),
  faces: z.array(z.unknown()).optional(),
  plane: z.looseObject({
    point: z.array(z.number()).length(3).optional(),
    normal: z.array(z.number()).length(3).optional(),
    axis: z.enum(["x", "y", "z"]).optional(),
    offset: z.number().optional(),
  }).optional(),
  keep: z.enum(["both", "positive", "negative"]).optional(),
  angle: z.number().optional(),
  twist: z.number().optional(),
  newObjectId: z.string().optional(),
  fill: z.boolean().optional(),
});

const previewSchema = z.looseObject({
  summary: z.string().optional(),
  commandCount: z.number().optional(),
  commands: z.array(commandSchema).optional(),
});

export interface ApprovalCommandView {
  id: string;
  text: string;
}

export interface ApprovalView {
  summary: string;
  commands: ApprovalCommandView[];
}

type Command = z.infer<typeof commandSchema>;

function describeCommand(command: Command): string {
  const target = command.objectId ?? "object";
  switch (command.type) {
    case "scene.duplicate_hierarchy":
      return `Create ${command.copies?.length ?? 1} hierarchy copies of ${command.sourceId ?? "object"} with independent geometry and material instances`;
    case "material.set_properties":
      return `Edit material slot ${command.slot ?? 0} on ${target}`;
    case "material.add_slot":
      return `Create material slot ${command.slot ?? "?"} on ${target}`;
    case "material.replace_slot":
      return `Replace material slot ${command.slot ?? 0} on ${target}`;
    case "material.assign":
      return `Assign material slot ${command.slot ?? 0} to ${command.ids ? command.ids.length + " base faces" : "all faces"} of ${target}`;
    case "scene.create_object":
      return `Create “${command.name ?? target}”`;
    case "scene.create_collection":
      return `Create collection “${command.name ?? command.collectionId ?? "collection"}”${command.parentCollectionId ? ` in ${command.parentCollectionId}` : ""}`;
    case "scene.rename_collection":
      return `Rename collection ${command.collectionId ?? ""} to “${command.name ?? ""}”`;
    case "scene.set_collection_visibility":
      return `${command.visible === false ? "Hide" : "Show"} collection ${command.collectionId ?? ""}`;
    case "scene.move_collection":
      return command.parentCollectionId ? `Move collection ${command.collectionId ?? ""} into ${command.parentCollectionId}` : `Move collection ${command.collectionId ?? ""} to the top`;
    case "scene.delete_collection":
      return `Delete the empty collection ${command.collectionId ?? ""}`;
    case "scene.move_to_collection":
      return `Put ${target} ${command.includeChildren === false ? "" : "and what hangs below it "}in ${command.collectionId ? `collection ${command.collectionId}` : "the scene itself"}`;
    case "scene.move_object":
      return `Move ${target} by [${(command.delta ?? []).join(", ")}] along its parent's axes`;
    case "scene.transform_object":
      return `Move or reshape ${target}`;
    case "scene.delete_object":
      return `Delete ${target}`;
    case "geometry.bevel":
      return `Bevel ${target} (${command.profile ?? "round"}, width ${command.width ?? "?"}, ${command.segments ?? 1} segments); adds a live modifier`;
    case "geometry.subdivide":
      return `Subdivide ${target} (${command.levels ?? "?"} ${command.method === "linear" ? "Linear" : command.method === "loop" ? "Loop" : "Catmull–Clark"} levels); adds a live modifier`;
    case "geometry.set_modifiers":
      return `Set the modifier stack on ${target} (${command.modifiers?.length ?? 0} modifiers)`;
    case "geometry.boolean":
      return `Boolean ${command.operation ?? "difference"} on ${target} using ${command.operandObjectId ?? "operand"}`;
    case "geometry.extrude": {
      const details = [
        command.normalDistance === undefined ? "" : `normal distance ${command.normalDistance}`,
        command.offset ? `local offset [${command.offset.join(", ")}]` : "",
        command.capScale === undefined ? "" : `cap scale ${command.capScale}`,
        command.capScaleXY ? `cap scale X/Y ${command.capScaleXY.join(" / ")}` : "",
        command.capRotationDegrees ? `cap rotation ${command.capRotationDegrees.join(" / ")}°` : "",
        command.normalMode === "individual" ? "individual face normals" : "",
        command.normalMode === "vertex" ? "vertex normals" : "",
        (command.steps ?? 1) > 1 ? `${command.steps} steps` : "",
        command.twistDegrees === undefined ? "" : `twist ${command.twistDegrees}°`,
        command.closeOpenSurface ? "close the source sheet" : "",
      ].filter(Boolean);
      return `Extrude ${command.kind ?? "components"} of ${target}${command.ids ? ` (${command.ids.length} components)` : ""}${details.length ? ` (${details.join(", ")})` : ""}`;
    }
    case "geometry.transform_components":
    case "geometry.transform_faces": {
      const transform = command.transform;
      const details = [
        transform?.position ? `move [${transform.position.join(", ")}]` : "",
        transform?.rotation ? `rotate [${transform.rotation.join(", ")}] radians` : "",
        transform?.scale ? `scale [${transform.scale.join(", ")}]` : "",
      ].filter(Boolean);
      return `Transform ${command.type === "geometry.transform_components" ? command.kind === "edge" ? "edges" : "vertices" : "faces"} of ${target}${command.ids ? ` (${command.ids.length})` : ""}${details.length ? ` · ${command.space ?? "local"} · ${details.join(", ")}` : ""}`;
    }
    case "geometry.knife_path":
      return `Cut a sequence of faces on ${target}`;
    case "geometry.knife_chord":
      return `Cut one face of ${target} between two edge points`;
    case "geometry.bisect": {
      const plane = command.plane;
      const where = plane?.axis !== undefined ? `at ${plane.axis} = ${plane.offset ?? 0}` : plane?.point && plane.normal ? `along the plane through [${plane.point.join(", ")}] facing [${plane.normal.join(", ")}]` : "along a plane";
      const sides = command.keep === "positive" || command.keep === "negative" ? `, keep the ${command.keep} side${command.fill ? " and cap the opening" : ""}` : "";
      return `Cut ${target} ${where} (${command.space ?? "local"} space)${sides}${command.ids ? ` · ${command.ids.length} faces only` : ""}`;
    }
    case "geometry.delete_components":
      return `Delete ${command.ids?.length ?? 0} ${command.kind ?? "component"}${(command.ids?.length ?? 0) === 1 ? "" : "s"} of ${target}`;
    case "geometry.flip_normals":
      return command.ids ? `Flip the surfaces of ${target} that contain ${command.ids.length} chosen face${command.ids.length === 1 ? "" : "s"}` : `Flip every surface of ${target} to face the other way`;
    case "geometry.separate_faces":
      return `Move ${command.ids?.length ?? 0} face${command.ids?.length === 1 ? "" : "s"} of ${target} into a new object “${command.name ?? command.newObjectId ?? "part"}”`;
    case "geometry.bridge_edge_loops":
      return `Bridge two boundary loops of ${target} (${command.ids?.length ?? 0} edges)${command.twist ? ` · twist ${command.twist}` : ""}`;
    case "geometry.set_shading":
      return `Shade ${target} ${command.mode === "flat" ? "flat" : command.angle === undefined ? "smooth" : `smooth with edges sharper than ${command.angle}° kept crisp`}`;
    case "geometry.triangulate_faces":
      return command.ids ? `Triangulate ${command.ids.length} face${command.ids.length === 1 ? "" : "s"} of ${target}` : `Triangulate every face of ${target}`;
    case "geometry.correct_normals":
      return `Correct face winding and rebuild normals on ${target} (${command.mode ?? "consistent"})`;
    case "geometry.remove_duplicate_faces":
      return `Remove matching duplicate faces from ${target}`;
    case "geometry.merge_by_distance":
      return `Merge nearby vertices of ${target} within ${String(command["distance"])} local units`;
    case "geometry.merge_vertices":
      return `Merge ${command.ids?.length ?? 0} vertices of ${target} (${command.mode ?? "center"})`;
    case "geometry.dissolve_edges":
      return `Dissolve ${command.ids?.length ?? 0} coplanar edges of ${target}`;
    case "geometry.slide_edges":
      return `Slide ${command.ids?.length ?? 0} edges of ${target} along chosen rails (${command.factor ?? "?"})`;
    case "geometry.loop_cut":
      return `Add ${command.cuts ?? 1} loop cuts on ${target} from edge ${command.edge ?? "?"}`;
    case "geometry.subdivide_faces":
      return `Subdivide the selected faces of ${target}`;
    case "geometry.inset_faces":
      return `${command.outset ? "Outset" : "Inset"} faces of ${target} · thickness ${command.thickness ?? "?"} · depth ${command.depth ?? 0}${command.individual ? " · individual faces" : ""}`;
    case "geometry.bevel_edges":
      return `Bevel ${command.ids?.length ?? 0} edges of ${target} · width ${command.width ?? "?"} · ${command.segments ?? 1} segments`;
    case "geometry.fill_hole":
      return `Fill the selected boundary loop on ${target}`;
    case "geometry.create_primitive":
      return `Add a ${command.primitive ?? "shape"}${command.name === undefined ? "" : ` “${command.name}”`} to ${target}${command.parentId === undefined ? "" : ` under ${command.parentId}`}${command.size === undefined ? "" : ` (size ${command.size})`}`;
    case "geometry.create_mesh":
      return `Add mesh ${command.name ?? target} (${command.vertices?.length ?? 0} vertices, ${command.faces?.length ?? 0} faces)`;
    default:
      return command.type;
  }
}

/** Turns the backend's approval preview into text a person can review at a glance. */
export function describeApproval(
  preview: Record<string, unknown>,
): ApprovalView {
  const parsed = previewSchema.safeParse(preview);
  if (!parsed.success)
    return { summary: "Approve the proposed scene changes?", commands: [] };
  return {
    summary: parsed.data.summary ?? "Approve the proposed scene changes?",
    commands: (parsed.data.commands ?? []).map((command) => ({
      id: command.commandId,
      text: describeCommand(command),
    })),
  };
}
