import { z } from "zod";

const commandSchema = z.looseObject({
  commandId: z.string(),
  type: z.string(),
  objectId: z.string().optional(),
  name: z.string().optional(),
  primitive: z.string().optional(),
  size: z.number().optional(),
  width: z.number().optional(),
  levels: z.number().optional(),
  segments: z.number().optional(),
  modifiers: z.array(z.unknown()).optional(),
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
    case "scene.transform_object":
      return `Move or reshape ${target}`;
    case "scene.delete_object":
      return `Delete ${target}`;
    case "geometry.bevel":
      return `Bevel ${target} (width ${command.width ?? "?"}, ${command.segments ?? 1} segments); adds a live modifier`;
    case "geometry.subdivide":
      return `Subdivide ${target} (${command.levels ?? "?"} Catmull–Clark levels); adds a live modifier`;
    case "geometry.set_modifiers":
      return `Set the modifier stack on ${target} (${command.modifiers?.length ?? 0} modifiers)`;
    case "geometry.create_primitive":
      return `Add a ${command.primitive ?? "shape"} to ${target}${command.size === undefined ? "" : ` (size ${command.size})`}`;
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
