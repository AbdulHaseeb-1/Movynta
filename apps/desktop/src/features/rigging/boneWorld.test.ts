import { describe, expect, it } from "vitest";
import { Group, Vector3 } from "three";
import { BoneWorld } from "./boneWorld";
import { rigOf, type Rig } from "./rig";
import { buildRiggedModel } from "./rigFixture";

function rigFor(model: Group): Rig {
  const rig = rigOf(model);
  if (!rig) throw new Error("expected the model to have a rig");
  return rig;
}

/** Where three.js itself puts each bone, once the whole model's matrices are brought up to date. */
function referenceJoints(model: Group, rig: Rig): number[] {
  model.updateMatrixWorld(true);
  return rig.bones.flatMap((bone) => bone.getWorldPosition(new Vector3()).toArray());
}

describe("the joints of a rig in the world", () => {
  it("are where three.js puts the bones, however the model and the bones are moved", () => {
    const model = buildRiggedModel(15);
    const rig = rigFor(model);
    model.position.set(3, -1, 2);
    model.rotation.set(0.3, 1.1, -0.4);
    model.scale.setScalar(1.7);
    rig.bones.forEach((bone, index) => {
      bone.rotation.z = index * 0.1;
      bone.scale.y = 1 + index * 0.02;
    });

    const world = new BoneWorld(rig);
    world.update();
    const expected = referenceJoints(model, rig);
    expected.forEach((value, at) => expect(world.positions[at]).toBeCloseTo(value, 9));
  });

  it("follow a change the renderer has not seen yet, because they read the local transforms", () => {
    const model = buildRiggedModel(5);
    const rig = rigFor(model);
    model.updateMatrixWorld(true);
    const world = new BoneWorld(rig);
    world.update();
    const before = Array.from(world.positions);

    model.position.x += 4;
    rig.bones[1]?.position.set(0, 5, 0);
    world.update();
    expect(Array.from(world.positions)).not.toEqual(before);
    const expected = referenceJoints(model, rig);
    expected.forEach((value, at) => expect(world.positions[at]).toBeCloseTo(value, 9));
  });

  it("are found for a rig whose first bone hangs from something that is not a bone", () => {
    const model = buildRiggedModel(3);
    const armature = new Group();
    armature.scale.setScalar(0.5);
    armature.position.y = 2;
    const first = model.children[0];
    if (!first) throw new Error("expected a first bone");
    armature.add(first);
    model.add(armature);
    const rig = rigFor(model);

    const world = new BoneWorld(rig);
    world.update();
    referenceJoints(model, rig).forEach((value, at) => expect(world.positions[at]).toBeCloseTo(value, 9));
  });
});
