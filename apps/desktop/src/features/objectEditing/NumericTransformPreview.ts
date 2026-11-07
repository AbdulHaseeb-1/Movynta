import type { Object3D } from "three";
import type { EditorScene, ObjectTransform } from "@/features/assistant";
import type { ObjectChange } from "./ObjectGizmo";
import { sameTransform } from "./transformMath";

/** Previews one numeric gesture without changing saved history until release. */
export class NumericTransformPreview {
  private readonly object: Object3D;
  private readonly before: ObjectTransform;
  private readonly revision: number;
  constructor(privateScene: EditorScene, privateId: string) {
    const object = privateScene.getObject(privateId);
    const before = privateScene.transformOf(privateId);
    if (!object || !before) throw new Error("Select an object first.");
    this.scene = privateScene;
    this.id = privateId;
    this.object = object;
    this.before = before;
    this.revision = privateScene.currentRevision;
  }
  private readonly scene: EditorScene;
  private readonly id: string;
  valid(): boolean {
    return (
      this.scene.currentRevision === this.revision &&
      this.scene.selection === this.id &&
      this.scene.getObject(this.id) === this.object &&
      !this.scene.requiresRecovery
    );
  }
  private apply(transform: ObjectTransform): void {
    this.object.position.fromArray(transform.position);
    this.object.rotation.set(...transform.rotation);
    this.object.scale.fromArray(transform.scale);
    this.object.updateMatrixWorld(true);
  }
  preview(patch: Partial<ObjectTransform>): ObjectTransform | undefined {
    if (!this.valid()) return undefined;
    const current = this.scene.transformOf(this.id);
    if (!current) return undefined;
    const next = { ...current, ...patch };
    if (
      ![...next.position, ...next.rotation, ...next.scale].every(Number.isFinite) ||
      next.scale.some((value) => value <= 0)
    )
      return undefined;
    this.apply(next);
    this.scene.previewBooleans();
    return next;
  }
  finish(commit: boolean): ObjectChange | undefined {
    if (this.scene.currentRevision !== this.revision || this.scene.getObject(this.id) !== this.object) return undefined;
    const eligible = this.valid();
    const after = eligible ? this.scene.transformOf(this.id) : undefined;
    this.apply(this.before);
    this.scene.previewBooleans();
    return commit && eligible && after && !sameTransform(this.before, after)
      ? { id: this.id, before: this.before, after }
      : undefined;
  }
}
