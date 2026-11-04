import { describe, expect, it } from "vitest";
import { Scene } from "three";
import { editorCommandListSchema, editorContextSchema, validateAgainstContext } from "@movynta/editor-protocol";
import { EditorScene } from "./EditorScene";

/**
 * The backend judges a proposal on a snapshot of the scene before it is applied; the editor then applies it for
 * real. They must agree: a batch the validator lets through must apply, and one it refuses must not have applied.
 * Here random batches of scene and collection commands are put to both, and every disagreement is a bug in one.
 * Nothing here turns or scales an object, because refusing a re-parenting that would shear a mesh is deliberately
 * stricter than the editor (see reparentAgreement.test.ts).
 */

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const OBJECTS = ["o0", "o1", "o2", "o3", "o4", "o5", "o6", "o7", "ghost"];
const COLLECTIONS = ["k0", "k1", "k2", "k3", "k4", "nowhere"];
const NAMES = ["A", "B", "C", "Arm"];

type Command = Record<string, unknown>;

/** What the generator may read of the scene a batch is written for, so it can aim at things that exist. */
type SceneView = Pick<ReturnType<typeof editorContextSchema.parse>, "objects">;

function generator(next: () => number, scene: SceneView) {
  const pick = <T>(values: readonly T[]): T => {
    const value = values[Math.floor(next() * values.length)];
    if (value === undefined) throw new Error("Nothing to pick from");
    return value;
  };
  const maybe = <T>(value: T, chance = 0.5): T | undefined => (next() < chance ? value : undefined);
  const object = () => pick(OBJECTS);
  const collection = () => pick(COLLECTIONS);
  const nullable = <T>(value: T) => (next() < 0.25 ? null : value);
  let serial = 0;
  const id = () => `c${(serial += 1)}`;
  const real = () => pick(scene.objects);
  /**
   * Short sequences that depend on what an earlier command of the same batch did, which random commands almost never
   * line up: emptying a collection by deleting or moving what is in it and then deleting it, or putting a child under
   * a parent that is in a collection and then moving the parent out.
   */
  const sequence = (): Command[] => {
    const target = real();
    const home = target?.collectionId ?? null;
    switch (Math.floor(next() * 4)) {
      case 0:
        return home === null || !target ? [] : [{ commandId: id(), type: "scene.delete_object", objectId: target.id }, { commandId: id(), type: "scene.delete_collection", collectionId: home }];
      case 1:
        return home === null || !target ? [] : [
          { commandId: id(), type: "geometry.create_primitive", objectId: pick(["n0", "n1", "o0", "o1"]), primitive: "box", size: 1, replaceExisting: false, parentId: target.id },
          { commandId: id(), type: "scene.move_to_collection", objectId: target.id, collectionId: null, includeChildren: next() < 0.5 },
          { commandId: id(), type: "scene.delete_collection", collectionId: home },
        ];
      case 2:
        return !target ? [] : [
          { commandId: id(), type: "scene.move_to_collection", objectId: target.id, collectionId: pick(COLLECTIONS), includeChildren: next() < 0.5 },
          ...(home === null ? [] : [{ commandId: id(), type: "scene.delete_collection", collectionId: home }]),
        ];
      default:
        return [
          { commandId: id(), type: "scene.create_collection", collectionId: pick(["n0", "n1", "k3"]), name: pick(NAMES) },
          ...(target ? [{ commandId: id(), type: "scene.move_to_collection", objectId: target.id, collectionId: pick(["n0", "n1", "k3", null]), includeChildren: next() < 0.5 }] : []),
          { commandId: id(), type: "scene.delete_collection", collectionId: pick(["n0", "n1", "k3"]) },
        ];
    }
  };
  const single = (): Command => {
    const commandId = id();
    switch (Math.floor(next() * 14)) {
      case 0: return { commandId, type: "scene.create_collection", collectionId: collection(), name: pick(NAMES), ...(maybe({ p: collection() })?.p ? { parentCollectionId: collection() } : {}) };
      case 1: return { commandId, type: "scene.rename_collection", collectionId: collection(), name: pick(NAMES) };
      case 2: return { commandId, type: "scene.set_collection_visibility", collectionId: collection(), visible: next() < 0.5 };
      case 3: return { commandId, type: "scene.move_collection", collectionId: collection(), parentCollectionId: nullable(collection()) };
      case 4: return { commandId, type: "scene.delete_collection", collectionId: collection() };
      case 5: case 6: return { commandId, type: "scene.move_to_collection", objectId: object(), collectionId: nullable(collection()), includeChildren: next() < 0.6 };
      case 7: return { commandId, type: "geometry.create_primitive", objectId: object(), primitive: "box", size: 1, replaceExisting: false, ...(next() < 0.4 ? { parentId: object() } : {}), ...(next() < 0.4 ? { collectionId: collection() } : {}), ...(next() < 0.4 ? { name: pick(NAMES) } : {}) };
      case 8: return { commandId, type: "scene.create_object", objectId: object(), name: pick(NAMES), ...(next() < 0.4 ? { parentId: object() } : {}), ...(next() < 0.4 ? { collectionId: collection() } : {}) };
      case 9: return { commandId, type: "scene.set_parent", objectId: object(), parentId: nullable(object()) };
      case 10: return { commandId, type: "scene.delete_object", objectId: object() };
      case 11: return { commandId, type: "scene.rename_object", objectId: object(), name: pick(NAMES) };
      case 12: return { commandId, type: "scene.move_object", objectId: object(), delta: [1, 0, 0] };
      default: return { commandId, type: "scene.set_visibility", objectId: object(), visible: next() < 0.5 };
    }
  };
  return (): Command[] => (next() < 0.4 ? sequence() : [single()]);
}

/** A scene with a few collections and objects, each object in a random collection and under a random earlier object. */
function startingScene(next: () => number): EditorScene {
  const editor = new EditorScene(new Scene(), "p");
  const commands: Command[] = [
    { commandId: "k0", type: "scene.create_collection", collectionId: "k0", name: "Zero" },
    { commandId: "k1", type: "scene.create_collection", collectionId: "k1", name: "One", parentCollectionId: "k0" },
    { commandId: "k2", type: "scene.create_collection", collectionId: "k2", name: "Two" },
  ];
  const count = 3 + Math.floor(next() * 4);
  for (let index = 0; index < count; index += 1) {
    commands.push({
      commandId: `m${index}`, type: "geometry.create_primitive", objectId: `o${index}`, primitive: "box", size: 1, replaceExisting: false,
      ...(index > 0 && next() < 0.5 ? { parentId: `o${Math.floor(next() * index)}` } : {}),
      ...(next() < 0.6 ? { collectionId: ["k0", "k1", "k2"][Math.floor(next() * 3)] } : {}),
    });
  }
  if (editor.execute("start", 0, commands).status !== "applied") throw new Error("The starting scene could not be built");
  return editor;
}

describe("the validator and the editor agree on scene and collection commands", () => {
  it("accepts exactly the batches the editor applies, over many random batches", () => {
    const next = random(2026);
    let accepted = 0;
    let refused = 0;
    const disagreements: string[] = [];
    for (let round = 0; round < 500; round += 1) {
      const editor = startingScene(next);
      // Several batches in a row, each judged on the scene the one before left.
      for (let batch = 0; batch < 3; batch += 1) {
        // The editor's own snapshot, checked against the protocol's schema, is what the backend would judge on.
        const context = editorContextSchema.parse(editor.context());
        const nextCommands = generator(next, context);
        const written = Array.from({ length: 1 + Math.floor(next() * 3) }, nextCommands).flat();
        if (written.length === 0) continue;
        const commands = editorCommandListSchema.parse(written);
        const issues = validateAgainstContext(commands, context);
        const applied = editor.execute(`r${round}-${batch}`, editor.currentRevision, commands).status === "applied";
        if (issues.length === 0 !== applied) {
          disagreements.push(`round ${round} batch ${batch}: validator ${issues.length === 0 ? "accepted" : `refused (${issues[0]?.message})`}, editor ${applied ? "applied" : "failed"}\n  ${JSON.stringify(commands)}`);
        }
        if (applied) accepted += 1;
        else refused += 1;
      }
    }
    expect(disagreements.slice(0, 5).join("\n")).toBe("");
    // The comparison means something only if both outcomes were really tried.
    expect(accepted).toBeGreaterThan(150);
    expect(refused).toBeGreaterThan(150);
  });
});
