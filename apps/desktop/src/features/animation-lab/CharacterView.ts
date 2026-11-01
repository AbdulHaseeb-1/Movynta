import { Group, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import type { CharacterSimulation } from "@/engine/CharacterSimulation";
import { BONE_NAMES, createBoneMap, type BoneMap, type BoneName } from "@/engine/character/types";
import { themeColor } from "./labTheme";
import { StickmanSkin } from "./skin";

/**
 * Draws the rig as one smooth, connected skinned mesh (`THREE.SkinnedMesh`): round limbs of a single stroke width that
 * blend into each other at every joint, and a spherical head. It only reads the simulation; the bone tree it drives
 * has the same names and parents as the simulation rig.
 */
export class CharacterView {
  readonly root = new Group();
  readonly skin: StickmanSkin;
  private readonly positions: BoneMap<Vector3> = createBoneMap(() => new Vector3());
  private readonly rotations: BoneMap<Quaternion> = createBoneMap(() => new Quaternion());
  private readonly material: MeshStandardMaterial;
  private readonly sim: CharacterSimulation;

  constructor(sim: CharacterSimulation) {
    this.sim = sim;
    // One matte color for the whole figure. The emissive term keeps the shading soft, like a flat drawing, while the
    // geometry stays genuinely 3D and still casts and receives shadows.
    const color = themeColor("character");
    this.material = new MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.9, metalness: 0 });
    const parents = createBoneMap((name) => sim.rig.definitions[name].parent);
    this.skin = new StickmanSkin(sim.rig.config, this.material, parents);
    this.root.add(this.skin.mesh);
    this.update(0);
  }

  /** Poses the skinned mesh from the simulation, interpolated by `alpha` between the last two steps. */
  update(alpha: number): void {
    for (const name of BONE_NAMES) this.sim.interpolated(name, alpha, this.positions[name], this.rotations[name]);
    this.skin.update(this.positions, this.rotations);
  }

  /** Interpolated world position of a bone, valid after `update`. */
  bonePosition(name: BoneName): Vector3 {
    return this.positions[name];
  }

  dispose(): void {
    this.root.removeFromParent();
    this.skin.dispose();
    this.material.dispose();
  }
}
