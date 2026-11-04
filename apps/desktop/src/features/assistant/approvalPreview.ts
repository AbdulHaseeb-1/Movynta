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
    case "scene.create_object":
      return `Create “${command.name ?? target}”`;
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
    case "geometry.transform_faces": {
      const transform = command.transform;
      const details = [
        transform?.position ? `move [${transform.position.join(", ")}]` : "",
        transform?.rotation ? `rotate [${transform.rotation.join(", ")}] radians` : "",
        transform?.scale ? `scale [${transform.scale.join(", ")}]` : "",
      ].filter(Boolean);
      return `Transform faces of ${target}${command.ids ? ` (${command.ids.length})` : ""}${details.length ? ` · ${command.space ?? "local"} · ${details.join(", ")}` : ""}`;
    }
    case "geometry.subdivide_faces":
      return `Subdivide the selected faces of ${target}`;
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
