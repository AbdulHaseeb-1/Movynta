import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  type BufferGeometry,
  type Object3D,
  type Scene,
} from "three";
import { editorCommandListSchema } from "@movynta/editor-protocol";
import type { z } from "zod";

type Command = z.infer<typeof editorCommandListSchema>[number];
function isMesh(object: Object3D | undefined): object is Mesh {
  return object instanceof Mesh;
}

/** Applies only the closed editor protocol. Batches are staged and committed atomically. */
export class EditorScene {
  private objects = new Map<string, Object3D>();
  private readonly applied = new Set<string>();
  private revision = 0;
  private readonly scene: Scene;
  readonly projectId: string;
  constructor(scene: Scene, projectId: string) {
    this.scene = scene;
    this.projectId = projectId;
  }

  context() {
    const ids = new Map([...this.objects].map(([id, object]) => [object, id]));
    return {
      projectId: this.projectId,
      revision: this.revision,
      activeSceneName: "Main",
      selectedObjectIds: [],
      objects: [...this.objects].map(([id, object]) => ({
        id,
        name: object.name,
        type: object instanceof Mesh ? "mesh" : "empty",
        parentId:
          object.parent && object.parent !== this.scene
            ? (ids.get(object.parent) ?? null)
            : null,
        transform: {
          position: object.position.toArray(),
          rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
          scale: object.scale.toArray(),
        },
      })),
    };
  }

  execute(proposalId: string, expectedRevision: number, input: unknown) {
    const commands = editorCommandListSchema.parse(input);
    const results = commands.map((command) => ({
      commandId: command.commandId,
      status: "applied" as const,
    }));
    if (this.applied.has(proposalId))
      return { status: "applied", revision: this.revision, results };
    if (expectedRevision !== this.revision)
      return {
        status: "revision_conflict",
        revision: this.revision,
        results: [],
      };
    const staged = new Map<string, Object3D>();
    const ids = new Map([...this.objects].map(([id, object]) => [object, id]));
    for (const [id, object] of this.objects) {
      const clone = object.clone(false);
      staged.set(id, clone);
    }
    for (const [id, object] of this.objects) {
      const parent = object.parent;
      if (parent && parent !== this.scene) {
        const parentId = ids.get(parent);
        const clonedParent = parentId ? staged.get(parentId) : undefined;
        const clone = staged.get(id);
        if (clone && clonedParent) clonedParent.add(clone);
      }
    }
    try {
      for (const command of commands) this.apply(staged, command);
    } catch {
      for (const [id, object] of staged) {
        const original = this.objects.get(id);
        if (
          !original ||
          (isMesh(object) &&
            isMesh(original) &&
            object.geometry !== original.geometry)
        )
          this.dispose(object);
      }
      return {
        status: "failed",
        revision: this.revision,
        results: commands.map((command) => ({
          commandId: command.commandId,
          status: "failed" as const,
        })),
        message: "The scene command batch was rejected",
      };
    }
    for (const [id, object] of this.objects) {
      object.removeFromParent();
      const replacement = staged.get(id);
      if (
        !replacement ||
        (replacement instanceof Mesh &&
          object instanceof Mesh &&
          replacement.geometry !== object.geometry)
      )
        this.dispose(object);
    }
    this.objects = staged;
    const stagedObjects = new Set(staged.values());
    for (const object of staged.values())
      if (!object.parent || !stagedObjects.has(object.parent))
        this.scene.add(object);
    this.revision += 1;
    this.applied.add(proposalId);
    return { status: "applied", revision: this.revision, results };
  }

  private apply(objects: Map<string, Object3D>, command: Command) {
    const existing = objects.get(command.objectId);
    if (command.type === "scene.delete_object") {
      if (!existing) throw new Error("Missing object");
      for (const child of existing.children) {
        const id = [...objects].find(([, object]) => object === child)?.[0];
        if (id) throw new Error("Delete children before their parent");
      }
      existing.removeFromParent();
      objects.delete(command.objectId);
      return;
    }
    if (command.type === "scene.transform_object") {
      if (!existing) throw new Error("Missing object");
      this.transform(existing, command.transform);
      return;
    }
    if (
      existing &&
      !(command.type === "geometry.create_primitive" && command.replaceExisting)
    )
      throw new Error("Duplicate object");
    let object: Object3D;
    if (command.type === "geometry.create_primitive") {
      const size = command.size;
      const geometry: BufferGeometry =
        command.primitive === "sphere"
          ? new SphereGeometry(size / 2, 24, 16)
          : command.primitive === "cylinder"
            ? new CylinderGeometry(size / 2, size / 2, size, 24)
            : command.primitive === "plane"
              ? new PlaneGeometry(size, size)
              : new BoxGeometry(size, size, size);
      object = new Mesh(
        geometry,
        new MeshStandardMaterial({ color: "#b6aaa4", roughness: 0.65 }),
      );
      object.name = command.primitive;
    } else {
      object = new Group();
      object.name = command.name;
      if (command.transform) this.transform(object, command.transform);
    }
    if (existing) {
      for (const child of [...existing.children]) object.add(child);
      existing.removeFromParent();
    }
    objects.set(command.objectId, object);
    if (command.type === "scene.create_object" && command.parentId) {
      const parent = objects.get(command.parentId);
      if (!parent || parent === object) throw new Error("Missing parent");
      parent.add(object);
    }
  }
  private transform(
    object: Object3D,
    transform: {
      position?: number[] | undefined;
      rotation?: number[] | undefined;
      scale?: number[] | undefined;
    },
  ) {
    if (transform.position) object.position.fromArray(transform.position);
    if (transform.rotation) {
      const [x = 0, y = 0, z = 0] = transform.rotation;
      object.rotation.set(x, y, z);
    }
    if (transform.scale) object.scale.fromArray(transform.scale);
  }
  private dispose(object: Object3D) {
    if (isMesh(object)) {
      object.geometry.dispose();
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      materials.forEach((material) => material.dispose());
    }
  }
}
