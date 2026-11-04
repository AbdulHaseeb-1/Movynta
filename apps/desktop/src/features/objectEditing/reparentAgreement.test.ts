import { describe, expect, it } from "vitest";
import { Mesh, Scene } from "three";
import { isWithinBranch, PlacementTracker } from "@movynta/editor-protocol";
import { EditorScene } from "@/features/assistant/EditorScene";

/** A small seeded generator, so a failing case can be reproduced. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
const between = (next: () => number, low: number, high: number) => low + (high - low) * next();
type Vec3 = [number, number, number];

/** A scene of boxes, each under an earlier one or at the top, with free positions, turns and scales. */
function buildScene(next: () => number, count: number): { editor: EditorScene; ids: string[] } {
  const editor = new EditorScene(new Scene(), "p");
  const ids: string[] = [];
  const commands = Array.from({ length: count }, (_, index) => {
    const id = `m${index}`;
    ids.push(id);
    const uniform = next() < 0.35;
    const s = between(next, 0.5, 2);
    const scale: Vec3 = uniform ? [s, s, s] : [between(next, 0.5, 2), between(next, 0.5, 2), between(next, 0.5, 2)];
    const parent = index > 0 && next() < 0.7 ? `m${Math.floor(next() * index)}` : undefined;
    return {
      commandId: `c${index}`, type: "geometry.create_primitive", objectId: id, primitive: "box", size: 1, replaceExisting: false,
      ...(parent ? { parentId: parent } : {}),
      transform: {
        position: [between(next, -5, 5), between(next, -5, 5), between(next, -5, 5)] as Vec3,
        rotation: [between(next, -3, 3), between(next, -1.4, 1.4), between(next, -3, 3)] as Vec3,
        scale,
      },
    };
  });
  const result = editor.execute("build", 0, commands);
  if (result.status !== "applied") throw new Error("The scene could not be built");
  return { editor, ids };
}

const geometries = (editor: EditorScene, ids: readonly string[]) =>
  new Map(ids.map((id) => {
    const object = editor.getObject(id);
    return [id, object instanceof Mesh ? object.geometry : undefined] as const;
  }));

/** Whether the editor had to fold a leftover into any mesh: it replaces the geometry of a mesh it bakes. */
function baked(editor: EditorScene, ids: readonly string[], run: () => void): boolean {
  const before = geometries(editor, ids);
  run();
  const after = geometries(editor, ids);
  return ids.some((id) => before.get(id) !== after.get(id));
}

function randomMoves(next: () => number, editor: EditorScene, ids: readonly string[], count: number) {
  const parents = new Map(editor.context().objects.map((object) => [object.id, object.parentId] as const));
  const moves: { objectId: string; parentId: string | null }[] = [];
  for (let attempt = 0; attempt < count * 4 && moves.length < count; attempt += 1) {
    const objectId = ids[Math.floor(next() * ids.length)] ?? "m0";
    const target = next() < 0.2 ? null : (ids[Math.floor(next() * ids.length)] ?? null);
    if (target === objectId || (target !== null && isWithinBranch(target, objectId, (id) => parents.get(id)))) continue;
    moves.push({ objectId, parentId: target });
    parents.set(objectId, target);
  }
  return moves;
}

const setParent = (index: number, move: { objectId: string; parentId: string | null }) => ({ commandId: `s${index}`, type: "scene.set_parent", ...move });

describe("the validator's judgement of a re-parenting agrees with the editor", () => {
  it("refuses exactly the single moves that the editor would have to bake", () => {
    const next = random(11);
    let refused = 0;
    let allowed = 0;
    for (let round = 0; round < 40; round += 1) {
      const { editor, ids } = buildScene(next, 8);
      for (const [index, move] of randomMoves(next, editor, ids, 8).entries()) {
        const parents = new Map(editor.context().objects.map((object) => [object.id, object.parentId] as const));
        const verdict = new PlacementTracker(editor.context().objects, (id) => parents.get(id)).reparent(move.objectId, move.parentId);
        const bakes = baked(editor, ids, () => {
          const result = editor.execute(`move-${round}-${index}`, editor.currentRevision, [setParent(index, move)]);
          expect(result.status).toBe("applied");
        });
        expect(verdict !== undefined, `round ${round} move ${JSON.stringify(move)}`).toBe(bakes);
        if (verdict === undefined) allowed += 1;
        else refused += 1;
      }
    }
    // The comparison means something only if both outcomes were really tried.
    expect(refused).toBeGreaterThan(60);
    expect(allowed).toBeGreaterThan(60);
  });

  it("never accepts a batch the editor would bake, and is stricter only when an object is moved twice", () => {
    const next = random(12);
    let refused = 0;
    let allowed = 0;
    let stricter = 0;
    for (let round = 0; round < 400; round += 1) {
      const { editor, ids } = buildScene(next, 8);
      const moves = randomMoves(next, editor, ids, 3);
      const parents = new Map(editor.context().objects.map((object) => [object.id, object.parentId] as const));
      const tracker = new PlacementTracker(editor.context().objects, (id) => parents.get(id));
      // The same walk the validator does: judge a move before applying it, and stop at the first one refused.
      let anyRefused = false;
      for (const move of moves) {
        if (tracker.reparent(move.objectId, move.parentId) !== undefined) {
          anyRefused = true;
          break;
        }
        parents.set(move.objectId, move.parentId);
      }
      const bakes = baked(editor, ids, () => {
        const result = editor.execute(`batch-${round}`, editor.currentRevision, moves.map((move, index) => setParent(index, move)));
        expect(result.status).toBe("applied");
      });
      // The validator must never let through what the editor would fold into a mesh.
      if (bakes) expect(anyRefused, `round ${round}: the editor baked a batch that was accepted`).toBe(true);
      // Judging each move on its own is stricter than the editor, which settles shear once at the end of a batch.
      // That can only differ when the same object is moved more than once: through a sheared state, then out of it.
      if (anyRefused && !bakes) {
        stricter += 1;
        const objects = moves.map((move) => move.objectId);
        expect(new Set(objects).size, `round ${round}: refused a batch that was clean without moving an object twice`).toBeLessThan(objects.length);
      }
      if (anyRefused) refused += 1;
      else allowed += 1;
    }
    // Most random batches are refused, because three moves between scaled and turned parents seldom stay exact.
    expect(refused).toBeGreaterThan(100);
    expect(allowed).toBeGreaterThan(10);
    // The difference is rare (about 3% of the refusals); if it were common, the rule would be turning away batches that are fine.
    expect(stricter).toBeLessThan(refused * 0.1);
  });

  it("leaves a baked object exact, so moving it under the same parent again bakes nothing more", () => {
    const editor = new EditorScene(new Scene(), "p");
    const box = (id: string, transform: Record<string, unknown>) => ({ commandId: `c-${id}`, type: "geometry.create_primitive", objectId: id, primitive: "box", size: 1, replaceExisting: false, transform });
    editor.execute("a", 0, [box("group", { scale: [2, 1, 1] }), box("part", { rotation: [0.3, 0.6, 0.2] })]);
    const move = (proposalId: string) => [{ commandId: proposalId, type: "scene.set_parent", objectId: "part", parentId: "group" }];
    expect(baked(editor, ["group", "part"], () => void editor.execute("b", 1, move("b")))).toBe(true);
    // Before the stored rotation was normalized, the bake left the part slightly sheared and the next move baked again.
    expect(baked(editor, ["group", "part"], () => void editor.execute("c", editor.currentRevision, move("c")))).toBe(false);
    const part = editor.getObject("part");
    expect(part?.quaternion.length()).toBeCloseTo(1, 12);
  });

  it("follows a scale set earlier in the same batch", () => {
    const editor = new EditorScene(new Scene(), "p");
    const box = (id: string, transform: Record<string, unknown>) => ({ commandId: `c-${id}`, type: "geometry.create_primitive", objectId: id, primitive: "box", size: 1, replaceExisting: false, transform });
    editor.execute("a", 0, [box("group", {}), box("part", { rotation: [0, 0.6, 0] })]);
    const scale = { commandId: "scale", type: "scene.transform_object", objectId: "group", transform: { scale: [2, 1, 1] } };
    const parents = new Map(editor.context().objects.map((object) => [object.id, object.parentId] as const));
    const tracker = new PlacementTracker(editor.context().objects, (id) => parents.get(id));
    // Under the group as it is now, the move is exact; after the batch scales the group it is not.
    expect(new PlacementTracker(editor.context().objects, (id) => parents.get(id)).reparent("part", "group")).toBeUndefined();
    tracker.transformed("group", scale.transform);
    expect(tracker.reparent("part", "group")).toContain("shearing");
    expect(baked(editor, ["group", "part"], () => {
      editor.execute("b", 1, [scale, { commandId: "s", type: "scene.set_parent", objectId: "part", parentId: "group" }]);
    })).toBe(true);
  });
});
