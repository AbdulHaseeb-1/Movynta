import { CollectionModel } from "./collection-graph.js";
import { isCageEditCommand, isModifierCommand, isTopologyEditCommand } from "./command-traits.js";
import type { EditorCommand } from "./editor-command.schema.js";
import type { EditorContext } from "./editor-context.schema.js";
import { PlacementTracker } from "./placement-tracker.js";
import { isWithinBranch } from "./scene-graph.js";

/** One thing wrong with a proposed command, and how to fix it. */
export interface ProposalIssue {
  readonly commandId: string;
  readonly message: string;
}

/**
 * Checks references against the latest scene and against objects the same batch
 * creates, moves or deletes, in order. Returns one issue per problem, each saying how to fix it, so the
 * agent can correct everything in one retry.
 */
export function validateAgainstContext(commands: readonly EditorCommand[], context: EditorContext): ProposalIssue[] {
  /** Every object that exists at this point of the batch, mapped to its parent. */
  const parents = new Map<string, string | null>();
  for (const object of context.objects) parents.set(object.id, object.parentId);
  /**
   * What hangs below each object, built the first time a delete needs it and then kept up to date as the
   * batch goes, so a delete never scans the scene and a batch without deletes pays nothing for it.
   */
  let childrenOf: Map<string, Set<string>> | undefined;
  const link = (child: string, parent: string | null | undefined) => {
    if (!childrenOf || !parent) return;
    const siblings = childrenOf.get(parent);
    if (siblings) siblings.add(child);
    else childrenOf.set(parent, new Set([child]));
  };
  const children = (): Map<string, Set<string>> => {
    if (childrenOf) return childrenOf;
    childrenOf = new Map();
    for (const [id, parent] of parents) link(id, parent);
    return childrenOf;
  };
  /** Only a batch that moves an object to another parent has to follow where objects are. */
  const placement = commands.some((command) => command.type === "scene.set_parent")
    ? new PlacementTracker(context.objects, (id) => parents.get(id))
    : undefined;
  /** Collections are followed only by a batch that touches them, since nothing else depends on them. */
  const usesCollections = commands.some((command) => command.type.endsWith("_collection") || command.type === "scene.move_to_collection" || ("collectionId" in command && command.collectionId !== undefined && command.collectionId !== null));
  const collections = usesCollections
    ? new CollectionModel(context.collections ?? [], context.objects.map((object) => [object.id, object.collectionId ?? null] as const))
    : undefined;
  const createdInBatch = new Set<string>();
  const seenCommandIds = new Set<string>();
  const issues: ProposalIssue[] = [];
  if (commands.some((command) => command.type === "scene.duplicate_hierarchy") && commands.length !== 1) return [{ commandId: commands[0]?.commandId ?? "batch", message: "Duplicate one hierarchy per proposal" }];
  const materialEdits = commands.filter((command) => command.type === "material.set_properties" || command.type === "material.add_slot" || command.type === "material.replace_slot");
  if (materialEdits.length && (materialEdits.length !== commands.length || commands.length > 20)) {
    return [{ commandId: commands[0]?.commandId ?? "batch", message: "Use a separate batch of at most 20 material property/slot commands; assign faces in a following proposal" }];
  }
  if (commands.length !== 1 && commands.some(isTopologyEditCommand)) {
    return [{ commandId: commands[0]?.commandId ?? "batch", message: "Use one topology-changing edit (bevel_edges, merge, dissolve, loop cut, knife, bisect, delete, triangulate and similar) per proposal; inspect the resulting IDs before the next edit" }];
  }
  const modifiers = commands.filter(isModifierCommand);
  const cageEdits = commands.filter(isCageEditCommand);
  if (modifiers.length > 0 && (modifiers.length !== commands.length || commands.length > 20)) {
    return [{ commandId: commands[0]?.commandId ?? "batch", message: "Geometry batches accept only bevel/subdivision and Boolean modifier commands, at most 20; create/transform in separate proposals" }];
  }
  if (cageEdits.length > 0 && (cageEdits.length !== commands.length || commands.length > 20)) {
    return [{ commandId: commands[0]?.commandId ?? "batch", message: "Component edit batches accept only extrude, inset_faces, bevel_edges, transform_components, transform_faces, fill_hole, subdivide_faces and the other base-cage edits (knife, bisect, delete, flip, triangulate, merge, dissolve, slide, loop cut, material.assign), at most 20; a topology-changing edit runs alone. Create or transform objects in a separate proposal." }];
  }
  const issue = (commandId: string, message: string) => issues.push({ commandId, message });
  /** A zero or negative scale collapses or mirrors an object and breaks parenting and bounds, so it is refused. */
  const checkScale = (commandId: string, transform: { readonly scale?: readonly number[] | undefined } | undefined) => {
    if (transform?.scale?.some((value) => !(value > 0))) issue(commandId, "scale must be positive on every axis; zero or negative scale is not allowed");
  };
  const missing = (commandId: string, objectId: string) =>
    issue(commandId, `objectId "${objectId}" does not exist; create it first or use an id from editor.get_context`);

  /**
   * Records an object a command creates, under its parent, and reports what the editor would refuse.
   * `gated` is true when the command uses a field that older editors do not accept.
   */
  const collectionsSupported = (commandId: string): boolean => {
    if (context.supportsCollections === true) return true;
    issue(commandId, "This editor is too old for collections; update the editor, or leave collections out of this proposal");
    return false;
  };
  const placeCreated = (commandId: string, objectId: string, parentId: string | undefined, gated: boolean, collectionId?: string) => {
    if (collectionId !== undefined && collectionsSupported(commandId) && !collections?.has(collectionId)) {
      issue(commandId, `collectionId "${collectionId}" does not exist; create it in an earlier command or use an id from editor.get_context`);
    }
    if (gated && context.supportsSceneGraph !== true) {
      issue(commandId, "This editor is too old for name, parentId and transform on shapes and meshes; update the editor, or create the object and then use scene.rename_object, scene.set_parent and scene.transform_object");
    }
    if (parentId !== undefined && !parents.has(parentId)) {
      issue(
        commandId,
        `parentId "${parentId}" does not exist; create the parent in an earlier command or use an id from editor.get_context`,
      );
    }
    parents.set(objectId, parentId ?? null);
    link(objectId, parentId);
    createdInBatch.add(objectId);
    // A new object joins the collection it is given, else its parent's, else the scene itself.
    collections?.assign(objectId, collectionId !== undefined && collections.has(collectionId) ? collectionId : parentId === undefined ? null : collections.collectionOf(parentId));
  };

  for (const command of commands) {
    if (seenCommandIds.has(command.commandId)) {
      issue(command.commandId, "commandId is used more than once; every command needs its own commandId");
    }
    seenCommandIds.add(command.commandId);

    switch (command.type) {
      case "scene.duplicate_hierarchy": {
        if (!parents.has(command.sourceId)) missing(command.commandId, command.sourceId);
        if (context.supportsRepetition !== true) issue(command.commandId, "Update the editor for hierarchy duplication");
        const descendantIds = new Set(context.objects.filter((object) => object.id !== command.sourceId && isWithinBranch(object.id, command.sourceId, (id) => parents.get(id))).map((object) => object.id));
        let added = 0;
        for (const copy of command.copies) {
          if (copy.descendants.length !== descendantIds.size || copy.descendants.some((entry) => !descendantIds.has(entry.sourceId))) issue(command.commandId, "Map every registered descendant exactly once");
          for (const id of [copy.objectId, ...copy.descendants.map((entry) => entry.objectId)]) {
            if (parents.has(id)) issue(command.commandId, `Copy objectId "${id}" already exists`);
            parents.set(id, null); added++;
          }
        }
        if (context.objects.length + added > 2000) issue(command.commandId, "Copies exceed the 2000-object scene limit");
        break;
      }
      case "scene.create_object":
        if (parents.has(command.objectId)) {
          issue(command.commandId, existsMessage(command.objectId, createdInBatch, "scene.create_object"));
        }
        placeCreated(command.commandId, command.objectId, command.parentId, false, command.collectionId);
        checkScale(command.commandId, command.transform);
        placement?.created(command.objectId, command.transform);
        break;
      case "geometry.create_primitive":
        if (command.replaceExisting) {
          if (!parents.has(command.objectId)) {
            issue(
              command.commandId,
              `objectId "${command.objectId}" cannot be replaced because it does not exist; set replaceExisting to false to create it`,
            );
          }
        } else {
          if (parents.has(command.objectId)) {
            issue(command.commandId, existsMessage(command.objectId, createdInBatch, "geometry.create_primitive"));
          }
          placeCreated(command.commandId, command.objectId, command.parentId, command.parentId !== undefined || command.name !== undefined || command.transform !== undefined, command.collectionId);
          checkScale(command.commandId, command.transform);
          placement?.created(command.objectId, command.transform);
        }
        break;
      case "geometry.create_mesh":
        if (parents.has(command.objectId)) {
          issue(command.commandId, `objectId "${command.objectId}" already exists; use a fresh id for the mesh`);
        }
        placeCreated(command.commandId, command.objectId, command.parentId, command.parentId !== undefined || command.transform !== undefined, command.collectionId);
        checkScale(command.commandId, command.transform);
        placement?.created(command.objectId, command.transform);
        break;
      case "scene.create_collection":
      case "scene.rename_collection":
      case "scene.set_collection_visibility":
      case "scene.move_collection":
      case "scene.delete_collection": {
        if (!collectionsSupported(command.commandId) || !collections) break;
        const outcome =
          command.type === "scene.create_collection" ? collections.create(command.collectionId, command.name, command.parentCollectionId ?? null)
          : command.type === "scene.rename_collection" ? collections.rename(command.collectionId, command.name)
          : command.type === "scene.move_collection" ? collections.move(command.collectionId, command.parentCollectionId)
          : command.type === "scene.set_collection_visibility" ? collections.setVisible(command.collectionId, command.visible)
          : collections.remove(command.collectionId);
        const message = typeof outcome === "string" ? outcome : outcome && !outcome.ok ? outcome.message : undefined;
        if (message) issue(command.commandId, message);
        break;
      }
      case "scene.move_to_collection": {
        if (!collectionsSupported(command.commandId) || !collections) break;
        if (!parents.has(command.objectId)) {
          missing(command.commandId, command.objectId);
          break;
        }
        if (command.collectionId !== null && !collections.has(command.collectionId)) {
          issue(command.commandId, `collectionId "${command.collectionId}" does not exist; create it in an earlier command or use an id from editor.get_context`);
          break;
        }
        // The object and, unless asked not to, everything that hangs below it.
        const moving = [command.objectId];
        for (let id = moving.pop(), seen = new Set<string>(); id !== undefined; id = moving.pop()) {
          if (seen.has(id)) continue;
          seen.add(id);
          collections.assign(id, command.collectionId);
          if (command.includeChildren) moving.push(...(children().get(id) ?? []));
        }
        break;
      }
      case "scene.transform_object":
      case "scene.move_object":
      case "geometry.boolean":
      case "geometry.bevel":
      case "geometry.subdivide":
      case "geometry.set_modifiers":
      case "geometry.knife_path":
      case "geometry.knife_chord":
      case "geometry.bisect":
      case "geometry.delete_components":
      case "geometry.flip_normals":
      case "geometry.triangulate_faces":
      case "geometry.correct_normals":
      case "geometry.remove_duplicate_faces":
      case "geometry.merge_by_distance":
      case "geometry.merge_vertices":
      case "geometry.dissolve_edges":
      case "geometry.slide_edges":
      case "geometry.loop_cut":
      case "material.assign":
      case "material.set_properties":
      case "material.add_slot":
      case "material.replace_slot":
      case "geometry.transform_components":
      case "geometry.transform_faces":
      case "geometry.extrude":
      case "geometry.fill_hole":
      case "geometry.subdivide_faces":
      case "geometry.inset_faces":
      case "geometry.bevel_edges":
      case "scene.rename_object":
      case "scene.set_visibility":
        if (!parents.has(command.objectId)) missing(command.commandId, command.objectId);
        if (command.type === "scene.move_object" && context.supportsSceneGraph !== true) {
          issue(command.commandId, "This editor is too old for scene.move_object; use scene.transform_object with the new position");
        }
        if (command.type === "scene.transform_object") checkScale(command.commandId, command.transform);
        if (command.type === "scene.transform_object") placement?.transformed(command.objectId, command.transform);
        if (command.type === "scene.move_object") placement?.moved(command.objectId, command.delta);
        if (command.type === "geometry.set_modifiers" || command.type === "geometry.boolean") booleanOperandIssues(command, parents, issue);
        if (command.type === "geometry.set_modifiers" && command.modifiers.some((entry) => entry.kind === "array" || entry.kind === "mirror") && context.supportsRepetition !== true) issue(command.commandId, "Update the editor for array/mirror modifiers");
        break;
      case "scene.set_parent": {
        if (!parents.has(command.objectId)) {
          missing(command.commandId, command.objectId);
          break;
        }
        if (command.parentId !== null && !parents.has(command.parentId)) {
          issue(
            command.commandId,
            `parentId "${command.parentId}" does not exist; create the parent in an earlier command or use an id from editor.get_context`,
          );
          break;
        }
        if (command.parentId !== null && isWithinBranch(command.parentId, command.objectId, (id) => parents.get(id))) {
          issue(
            command.commandId,
            `"${command.objectId}" cannot be placed under "${command.parentId}": that would put it under itself or under something that hangs below it`,
          );
          break;
        }
        const unexact = placement?.reparent(command.objectId, command.parentId);
        if (unexact !== undefined) {
          issue(command.commandId, unexact);
          break;
        }
        // Later commands of the batch see the object under its new parent.
        const previousParent = parents.get(command.objectId);
        if (previousParent && childrenOf) childrenOf.get(previousParent)?.delete(command.objectId);
        parents.set(command.objectId, command.parentId);
        link(command.objectId, command.parentId);
        break;
      }
      case "scene.delete_object": {
        if (!parents.has(command.objectId)) {
          issue(command.commandId, `objectId "${command.objectId}" does not exist, so it cannot be deleted`);
          break;
        }
        const below = [...(children().get(command.objectId) ?? [])];
        if (below.length > 0) {
          issue(
            command.commandId,
            `objectId "${command.objectId}" still has children (${below.slice(0, 5).join(", ")}); delete the children first, in earlier commands`,
          );
        }
        const parent = parents.get(command.objectId);
        if (parent) children().get(parent)?.delete(command.objectId);
        children().delete(command.objectId);
        parents.delete(command.objectId);
        placement?.removed(command.objectId);
        collections?.forget(command.objectId);
        break;
      }
    }
  }
  issues.push(...booleanCycles(commands));
  return issues;
}

/**
 * Whether `candidate` is `id` itself or hangs below it, judged by the parents as the batch leaves them. Placing
 * `id` under such a candidate would make a cycle.
 */
function booleanOperandIssues(
  command: Extract<EditorCommand, { type: "geometry.set_modifiers" | "geometry.boolean" }>,
  parents: ReadonlyMap<string, string | null>,
  issue: (commandId: string, message: string) => void,
): void {
  const operands = command.type === "geometry.boolean"
    ? [command]
    : command.modifiers.filter((modifier) => modifier.kind === "boolean");
  for (const modifier of operands) {
    const sameMesh = modifier.operandObjectId === command.objectId
      && modifier.operandMeshPath.length === command.meshPath.length
      && modifier.operandMeshPath.every((part, index) => part === command.meshPath[index]);
    if (sameMesh) issue(command.commandId, "A boolean modifier cannot use its own mesh");
    else if (!parents.has(modifier.operandObjectId)) issue(command.commandId, `Boolean operand "${modifier.operandObjectId}" does not exist; create it before the modifier`);
  }
}

/** Detect cycles among the mesh parts configured in this proposal. */
function booleanCycles(commands: readonly EditorCommand[]): ProposalIssue[] {
  const edges = new Map<string, { commandId: string; operands: string[] }>();
  // JSON, since a part's name can contain a slash. A cycle through paths written in different forms (a name here, an
  // index there) is not seen here; the editor finds it when it evaluates.
  const key = (objectId: string, path: readonly (string | number)[]) => `${objectId}/${JSON.stringify(path)}`;
  for (const command of commands) {
    if (command.type !== "geometry.set_modifiers" && command.type !== "geometry.boolean") continue;
    const id = key(command.objectId, command.meshPath);
    const operands = command.type === "geometry.boolean"
      ? [...(edges.get(id)?.operands ?? []), key(command.operandObjectId, command.operandMeshPath)]
      : command.modifiers.flatMap((modifier) => modifier.kind === "boolean" && modifier.enabled
        ? [key(modifier.operandObjectId, modifier.operandMeshPath)] : []);
    edges.set(id, { commandId: command.commandId, operands });
  }
  const issues: ProposalIssue[] = [];
  const reported = new Set<string>();
  const state = new Map<string, "open" | "done">();
  const visit = (id: string): boolean => {
    const mark = state.get(id);
    if (mark === "done") return false;
    if (mark === "open") return true;
    state.set(id, "open");
    for (const operand of edges.get(id)?.operands ?? []) if (operand !== id && visit(operand)) return true;
    state.set(id, "done");
    return false;
  };
  for (const [id, edge] of edges) {
    state.clear();
    if (!visit(id) || reported.has(edge.commandId)) continue;
    reported.add(edge.commandId);
    issues.push({ commandId: edge.commandId, message: "Boolean modifiers form a cycle" });
  }
  return issues;
}

/** The fix depends on whether the id was taken by this same batch (a common mix-up) or already in the scene. */
function existsMessage(objectId: string, createdInBatch: ReadonlySet<string>, commandType: EditorCommand["type"]): string {
  if (createdInBatch.has(objectId)) {
    return commandType === "geometry.create_primitive"
      ? `objectId "${objectId}" was already created earlier in this batch. A primitive is its own object, so drop the scene.create_object and position it with scene.transform_object, or set replaceExisting to true to give that object the shape`
      : `objectId "${objectId}" is created more than once in this batch; use a different objectId`;
  }
  return `objectId "${objectId}" already exists in the scene; use a different objectId${
    commandType === "geometry.create_primitive" ? ", or set replaceExisting to true to replace its shape" : ""
  }`;
}
