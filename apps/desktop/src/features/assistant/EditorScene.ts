import {
  BoxGeometry,
  ConeGeometry,
  DoubleSide,
  FrontSide,
  TorusGeometry,
  CylinderGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  SkinnedMesh,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Scene,
} from "three";
import { editorCommandListSchema } from "@movynta/editor-protocol";
import type { z } from "zod";
import { sceneBounds } from "./sceneBounds";
import { Scene as ThreeScene } from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { extrudeRegion, writeExtrudedGeometry } from "../meshGeometry/meshExtrude";
import { copyTopology, readTopology } from "../meshGeometry/meshTopology";
import { assignLocalMatrix, settleShear } from "../objectEditing/shearFit";
import { assertEditableMesh, inspectMesh, meshAtPath, evaluateStack, evaluateBase, modifierStack, commitStack, copyModifierStack, disposeModifierStack, type ModifierStackState } from "../meshGeometry";
import type { MeshInspectionRequest } from "@movynta/editor-protocol";

type Command = z.infer<typeof editorCommandListSchema>[number];
type GeometryCommand = Extract<Command, { type: "geometry.bevel" | "geometry.subdivide" | "geometry.set_modifiers" }>;
type ExtrudeCommand = Extract<Command, { type: "geometry.extrude" }>;
function isGeometryCommand(command: Command): command is GeometryCommand {
  return command.type === "geometry.bevel" || command.type === "geometry.subdivide" || command.type === "geometry.set_modifiers";
}
function isExtrudeCommand(command: Command): command is ExtrudeCommand {
  return command.type === "geometry.extrude";
}
function revealExtrudeBackfaces(mesh: Mesh): void {
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  for (const material of materials) {
    if (material.side === DoubleSide) continue;
    material.side = DoubleSide;
    material.needsUpdate = true;
  }
}

/** Stands in for a project's id until the first prompt or import creates the project. */
export const UNSAVED_PROJECT_ID = "unsaved-project";

export type Vec3 = [number, number, number];
/** Where an object is: position, rotation (radians, XYZ order) and scale. */
export interface ObjectTransform {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

/** The result of a change the user made by hand. */
export interface UserEdit {
  applied: boolean;
  /** The commands to record with the project; they replay the change when it is reopened. */
  commands: unknown[];
}

/** Whether an id is taken, without copying the ids. */
export interface IdLookup {
  has: (id: string) => boolean;
}

/** A model the user imported, as the project remembers it. */
export interface ImportedModelStep {
  kind: "import";
  assetId: string;
  objectId: string;
  name: string;
  format: string;
}
/** One saved change to the scene, in the order it happened. */
export type SceneStep =
  | { kind: "commands"; proposalId: string; commands?: unknown }
  | ImportedModelStep;
/** The commands that change objects that already exist, which is most of what the user does by hand. */
type InPlaceCommand = Extract<
  Command,
  { type: "scene.transform_object" | "scene.delete_object" | "scene.rename_object" | "scene.set_visibility" }
>;
/** The commands that change one existing object's own properties, without touching the hierarchy. */
type ObjectChange = Extract<Command, { type: "scene.transform_object" | "scene.rename_object" | "scene.set_visibility" }>;
function isInPlace(command: Command): command is InPlaceCommand {
  return (
    command.type === "scene.transform_object" ||
    command.type === "scene.delete_object" ||
    command.type === "scene.rename_object" ||
    command.type === "scene.set_visibility"
  );
}
function isMesh(object: Object3D | undefined): object is Mesh {
  return object instanceof Mesh;
}

/** Applies only the closed editor protocol. Batches are staged and committed atomically. */
export class EditorScene {
  private objects = new Map<string, Object3D>();
  private readonly applied = new Set<string>();
  private revision = 0;
  private prepared: { id: string; revision: number; candidate: EditorScene } | undefined;
  private recoveryNeeded = false;
  get requiresRecovery(): boolean { return this.recoveryNeeded; }
  requireRecovery(): void { this.recoveryNeeded = true; }
  private readonly scene: Scene;
  private boundProjectId: string;
  /** The selected objects in the order they were chosen; the last one is the active object. */
  private selected: readonly string[] = [];
  private readonly listeners = new Set<() => void>();
  /** Each registered object's id, so finding it from the object never has to search. */
  private ids = new WeakMap<Object3D, string>();
  private readonly idLookup: IdLookup = { has: (id) => this.objects.has(id) };
  constructor(scene: Scene, projectId: string) {
    this.scene = scene;
    this.boundProjectId = projectId;
  }

  /** The project this scene belongs to; it is the id the backend authorizes editor connections for. */
  get projectId(): string {
    return this.boundProjectId;
  }

  /** True once the scene belongs to a saved project, which is what the user's edits are recorded in. */
  get hasProject(): boolean {
    return this.boundProjectId !== UNSAVED_PROJECT_ID;
  }

  get currentRevision(): number {
    return this.revision;
  }

  /** The id of the active object: the one chosen last, which the panel and the handles follow. */
  get selection(): string | null {
    return this.selected[this.selected.length - 1] ?? null;
  }

  /**
   * Every selected object, the active one last. The array is replaced, never changed, when the selection
   * changes, so it can be compared by identity to tell whether the selection is still the same.
   */
  get selectedIds(): readonly string[] {
    return this.selected;
  }

  /** Calls `listener` after anything in the scene changes: a batch, an import, a selection. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }

  getObject(id: string): Object3D | undefined {
    return this.objects.get(id);
  }

  /** Every object of the scene with its id, for walking the scene without copying it. */
  entries(): IterableIterator<readonly [string, Object3D]> {
    return this.objects.entries();
  }

  /** The objects a click can select. */
  pickables(): Object3D[] {
    return [...this.objects.values()];
  }

  /** The object that `node` belongs to: itself, or the closest one above it, such as a part of an imported model. */
  idOf(node: Object3D): string | undefined {
    for (let current: Object3D | null = node; current; current = current.parent) {
      const id = this.ids.get(current);
      if (id !== undefined) return id;
    }
    return undefined;
  }

  transformOf(id: string): ObjectTransform | undefined {
    const object = this.objects.get(id);
    if (!object) return undefined;
    return {
      position: object.position.toArray(),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
      scale: object.scale.toArray(),
    };
  }

  /** Selects one object alone, or clears the selection. An id that is not in the scene clears it. */
  select(id: string | null) {
    this.selectMany(id === null ? [] : [id]);
  }

  /** Selects exactly these objects, the last of them active. Ids that are not in the scene, and repeats, are left out. */
  selectMany(ids: readonly string[]) {
    const next: string[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      if (!this.objects.has(id) || seen.has(id)) continue;
      seen.add(id);
      next.push(id);
    }
    this.setSelection(next);
  }

  /**
   * Adds an object to the selection and makes it active, or, when it is the active object, takes it out.
   * An object that is selected but not active becomes the active one.
   */
  toggleSelection(id: string) {
    if (!this.objects.has(id)) return;
    const others = this.selected.filter((selectedId) => selectedId !== id);
    this.setSelection(this.selection === id ? others : [...others, id]);
  }

  selectAll() {
    this.setSelection([...this.objects.keys()]);
  }

  private setSelection(next: readonly string[]) {
    if (next.length === this.selected.length && next.every((id, at) => id === this.selected[at])) return;
    this.selected = next;
    this.notify();
  }

  /** Drops objects that no longer exist from the selection. */
  private pruneSelection() {
    if (this.selected.some((id) => !this.objects.has(id)))
      this.selected = this.selected.filter((id) => this.objects.has(id));
  }

  /**
   * Applies a move, rotation or scale the user made by hand, as a command like any other, so it takes
   * the same path as the assistant's changes and can be recorded and replayed.
   */
  applyUserTransform(id: string, transform: ObjectTransform): UserEdit {
    const commands = [
      { commandId: "edit", type: "scene.transform_object", objectId: id, transform },
    ];
    return { applied: this.applyUserEdit(commands), commands };
  }

  /** Applies a move, rotation or scale of several objects at once, as one batch of at most 50. */
  applyUserTransforms(changes: readonly { id: string; transform: ObjectTransform }[]): UserEdit {
    const commands = changes.map(({ id, transform }, index) => ({
      commandId: `edit-${index}`,
      type: "scene.transform_object",
      objectId: id,
      transform,
    }));
    return { applied: this.applyUserEdit(commands), commands };
  }

  /** Applies commands that came from the user, not the assistant. Returns whether they were applied. */
  applyUserEdit(commands: readonly unknown[]): boolean {
    return this.execute(`usr_${crypto.randomUUID()}`, this.revision, commands).status === "applied";
  }

  /**
   * The commands that delete objects together with everything attached below them, the deepest first,
   * as the scene requires. An object named twice, or reached from one that is also named, is deleted
   * once. Empty when none of the objects exists.
   */
  deleteCommandsFor(ids: string | readonly string[]): unknown[] {
    const named = (typeof ids === "string" ? [ids] : ids).filter((id) => this.objects.has(id));
    if (named.length === 0) return [];
    const below = new Map<string, string[]>();
    for (const [childId, object] of this.objects) {
      const parentId = object.parent ? this.ids.get(object.parent) : undefined;
      if (parentId === undefined) continue;
      const siblings = below.get(parentId);
      if (siblings) siblings.push(childId);
      else below.set(parentId, [childId]);
    }
    const order: string[] = [];
    const visited = new Set<string>();
    const visit = (current: string) => {
      if (visited.has(current)) return;
      visited.add(current);
      for (const child of below.get(current) ?? []) visit(child);
      order.push(current);
    };
    for (const id of named) visit(id);
    return order.map((objectId, index) => ({
      commandId: `delete-${index}`,
      type: "scene.delete_object",
      objectId,
    }));
  }

  /** Attaches the scene to a project created after the editor opened, i.e. on the first prompt. */
  bindProject(projectId: string) {
    this.boundProjectId = projectId;
  }

  /** Transfer a fully replayed scene only after its durable history change has committed. */
  replaceFrom(candidate: EditorScene): void {
    const revision = this.revision + 1;
    const selection = this.selected;
    this.reset();
    this.objects = candidate.objects;
    this.ids = candidate.ids;
    for (const id of candidate.applied) this.applied.add(id);
    const roots = [...candidate.scene.children];
    for (const root of roots) this.scene.add(root);
    this.revision = revision;
    this.recoveryNeeded = false;
    this.selected = selection.filter((id) => this.objects.has(id));
    candidate.objects = new Map();
    candidate.ids = new WeakMap();
    candidate.applied.clear();
    this.notify();
  }

  /** Resource-independent candidate: discarding it cannot dispose geometry in the displayed scene. */
  private fork(): EditorScene {
    let bytes = 0;
    const measured = new Set<Object3D>();
    for (const root of this.objects.values()) root.traverse((node) => {
      if (measured.has(node)) return;
      measured.add(node);
      if (isMesh(node)) {
        for (const attribute of Object.values(node.geometry.attributes)) bytes += attribute.count * attribute.itemSize * 8;
        for (const attribute of Object.values(node.geometry.morphAttributes).flatMap((targets) => targets ?? [])) bytes += attribute.count * attribute.itemSize * 8;
        bytes += (node.geometry.index?.count ?? 0) * 4;
      }
    });
    if (bytes > 128 * 1024 * 1024) throw new Error("This scene exceeds the 128 MiB prepared-geometry budget; simplify it before assistant editing");
    const candidate = new EditorScene(new ThreeScene(), this.projectId);
    const copied = new Map<Object3D, Object3D>();
    const registered = new Set(this.objects.values());
    for (const object of this.objects.values()) {
      let nested = false;
      for (let p = object.parent; p; p = p.parent) if (registered.has(p)) { nested = true; break; }
      if (nested) continue;
      const copy = cloneSkeleton(object);
      const originals: Object3D[] = []; const clones: Object3D[] = [];
      object.traverse((node) => originals.push(node)); copy.traverse((node) => clones.push(node));
      originals.forEach((node, i) => {
        const cloned = clones[i]; if (!cloned) throw new Error("Could not clone scene");
        copied.set(node, cloned);
        if (isMesh(node) && isMesh(cloned)) {
          cloned.geometry = node.geometry.clone(); copyTopology(node.geometry, cloned.geometry);
          cloned.material = Array.isArray(node.material) ? node.material.map((material) => material.clone()) : node.material.clone();
          copyModifierStack(node, cloned);
        }
      });
      candidate.scene.add(copy);
    }
    for (const [id, original] of this.objects) {
      const copy = copied.get(original); if (!copy) throw new Error("Could not clone scene object");
      candidate.objects.set(id, copy); candidate.ids.set(copy, id);
    }
    candidate.selected = [...this.selected]; candidate.revision = this.revision;
    for (const id of this.applied) candidate.applied.add(id);
    return candidate;
  }

  executePrepared(proposalId: string, expectedRevision: number, input: unknown, phase: "prepare" | "commit" | "discard") {
    const commands = editorCommandListSchema.parse(input);
    const applied = () => ({ status: "applied", revision: this.revision, results: commands.map((command) => ({ commandId: command.commandId, status: "applied" as const })) });
    if (phase === "discard") {
      if (this.prepared?.id === proposalId) { this.prepared.candidate.reset(); this.prepared = undefined; }
      return applied();
    }
    if (this.applied.has(proposalId)) return applied();
    if (phase === "commit") {
      const pending = this.prepared;
      if (!pending || pending.id !== proposalId || pending.revision !== this.revision) throw new Error("Prepared scene is unavailable; reload the saved project");
      this.prepared = undefined; this.replaceFrom(pending.candidate); return applied();
    }
    if (this.prepared?.id === proposalId) return { ...applied(), revision: this.prepared.candidate.currentRevision };
    if (this.prepared) throw new Error("Another scene change is being prepared");
    const candidate = this.fork();
    let result: ReturnType<EditorScene["execute"]>;
    try { result = candidate.execute(proposalId, expectedRevision, commands); }
    catch (error) { candidate.reset(); throw error; }
    if (result.status === "applied") this.prepared = { id: proposalId, revision: this.revision, candidate };
    else candidate.reset();
    return result;
  }

  /**
   * Rebuilds a saved scene by replaying its steps in order. `loadImport` fetches and parses an imported
   * model. Fails, leaving the scene as far as it got, if a step cannot be replayed, so a damaged
   * project is reported instead of shown half-empty.
   */
  async restore(
    steps: readonly SceneStep[],
    loadImport: (step: ImportedModelStep) => Promise<Object3D>,
  ) {
    for (const step of steps) {
      if (step.kind === "import") {
        // Steps must replay one after another, in the order they happened.
        // eslint-disable-next-line no-await-in-loop
        this.importObject(step.objectId, await loadImport(step));
        continue;
      }
      const result = this.execute(step.proposalId, this.revision, step.commands);
      if (result.status !== "applied")
        throw new Error("This project's scene could not be restored");
    }
  }

  /** Empties the scene, as when a project is opened again after a failed attempt. */
  reset() {
    this.discardPrepared();
    for (const object of this.objects.values()) this.disposeTree(object);
    this.objects = new Map();
    this.ids = new WeakMap();
    this.applied.clear();
    this.revision = 0;
    this.selected = [];
    this.notify();
  }
  discardPrepared(): void {
    const pending = this.prepared; this.prepared = undefined;
    pending?.candidate.reset();
  }

  /** The ids in use, so a new object can be given one that is free. */
  objectIds(): IdLookup {
    return this.idLookup;
  }

  /**
   * Adds an imported model as one object of the scene. The assistant can then move or delete it with
   * the usual commands, but its inner parts stay part of the model. This is a change made by the
   * user, not a proposal, so it moves the scene to a new revision directly.
   */
  importObject(objectId: string, object: Object3D) {
    if (this.recoveryNeeded) throw new Error("Reconnect to the saved project before editing");
    if (this.prepared) throw new Error("Wait for the prepared scene change to finish");
    if (this.objects.has(objectId))
      throw new Error(`Object "${objectId}" already exists`);
    this.objects.set(objectId, object);
    this.ids.set(object, objectId);
    if (!object.parent) this.scene.add(object);
    this.revision += 1;
    this.notify();
  }

  context(inspection?: MeshInspectionRequest) {
    this.scene.updateMatrixWorld(true);
    const bounds = sceneBounds(this.objects.values());
    const objects = [];
    for (const [id, object] of this.objects) {
      const parent = object.parent;
      const box = bounds.get(object);
      objects.push({
        id,
        name: object.name,
        type: object instanceof Mesh ? "mesh" : "empty",
        parentId: parent && parent !== this.scene ? (this.ids.get(parent) ?? null) : null,
        transform: {
          position: object.position.toArray(),
          rotation: [object.rotation.x, object.rotation.y, object.rotation.z],
          scale: object.scale.toArray(),
        },
        visible: object.visible,
        worldBounds: box && !box.isEmpty() ? { min: box.min.toArray(), max: box.max.toArray() } : null,
      });
    }
    return {
      projectId: this.projectId,
      revision: this.revision,
      activeSceneName: "Main",
      selectedObjectIds: this.selected.slice(-500),
      objects,
      supportsPreparedCommands: true,
      ...(inspection ? { meshInspection: inspectMesh(this.objects.get(inspection.objectId), inspection) } : {}),
    };
  }

  execute(proposalId: string, expectedRevision: number, input: unknown) {
    if (this.recoveryNeeded) throw new Error("Reconnect to the saved project before editing");
    if (this.prepared) throw new Error("Wait for the prepared scene change to finish");
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
    if (commands.some(isGeometryCommand)) return this.applyGeometryBatch(proposalId, commands, results);
    if (commands.some(isExtrudeCommand)) return this.applyExtrudeBatch(proposalId, commands, results);
    // Moving, turning, resizing and deleting are the common edits, and need no copy of the scene to be safe.
    if (commands.every(isInPlace)) return this.applyInPlace(proposalId, commands, results);
    const staged = new Map<string, Object3D>();
    /** Which original each staged copy was made from. */
    const copiedFrom = new Map<Object3D, Object3D>();
    const ids = new Map([...this.objects].map(([id, object]) => [object, id]));
    for (const [id, object] of this.objects) {
      const clone = object.clone(false);
      if (isMesh(object) && isMesh(clone)) copyModifierStack(object, clone);
      staged.set(id, clone);
      copiedFrom.set(clone, object);
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
    let current: Command | undefined;
    try {
      for (const command of commands) {
        current = command;
        this.apply(staged, command);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Command failed";
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
          message:
            command === current
              ? reason
              : "Not applied: the batch was rolled back",
        })),
        message: `The batch was rolled back: command ${current?.commandId ?? "?"} failed. ${reason}`,
      };
    }
    const registered = new Set(this.objects.values());
    for (const [id, object] of this.objects) {
      const replacement = staged.get(id);
      // An imported model keeps its inner parts: they follow the object into its new copy, or go with it.
      // One pass splits them from the scene's own objects, which stay attached for the next step.
      const kept: Object3D[] = [];
      const inner: Object3D[] = [];
      for (const child of object.children) (registered.has(child) ? kept : inner).push(child);
      if (inner.length > 0) {
        object.children = kept;
        if (replacement && copiedFrom.get(replacement) === object) this.adopt(replacement, inner);
        else for (const child of inner) this.disposeTree(child);
      }
      object.removeFromParent();
      if (
        !replacement ||
        (replacement instanceof Mesh &&
          object instanceof Mesh &&
          replacement.geometry !== object.geometry)
      )
        this.dispose(object);
    }
    this.objects = staged;
    for (const [id, object] of staged) this.ids.set(object, id);
    const stagedObjects = new Set(staged.values());
    for (const object of staged.values())
      if (!object.parent || !stagedObjects.has(object.parent))
        this.scene.add(object);
    // Reparent may have left an exact matrix that position, rotation and scale cannot store.
    settleShear(staged.values());
    this.revision += 1;
    this.applied.add(proposalId);
    this.pruneSelection();
    this.notify();
    return { status: "applied", revision: this.revision, results };
  }

  /** Rewrites the base cage, then evaluates the same modifier list. A failure leaves the live mesh untouched. */
  private applyExtrudeBatch(proposalId: string, commands: Command[], results: { commandId: string; status: "applied" }[]) {
    interface Staged { base: BufferGeometry; display: BufferGeometry; modifiers: ModifierStackState["modifiers"]; reveal: boolean }
    const staged = new Map<Mesh, Staged>();
    let current: Command | undefined;
    const release = () => {
      for (const [mesh, state] of staged) {
        const live = modifierStack(mesh);
        const keep = new Set<BufferGeometry>([mesh.geometry]);
        if (live) { keep.add(live.base); keep.add(live.geometry); }
        if (!keep.has(state.base)) state.base.dispose();
        if (state.display !== state.base && !keep.has(state.display)) state.display.dispose();
      }
    };
    try {
      if (commands.length > 20 || !commands.every(isExtrudeCommand)) throw new Error("Extrude batches accept only extrude commands, at most 20; create or transform objects in a separate proposal");
      for (const command of commands) {
        current = command;
        const mesh = meshAtPath(this.objects.get(command.objectId), command.meshPath);
        assertEditableMesh(mesh);
        if (mesh instanceof SkinnedMesh) throw new Error("Extrude on skinned meshes is not supported yet.");
        const live = modifierStack(mesh);
        const previous = staged.get(mesh);
        const modifiers = previous?.modifiers ?? live?.modifiers ?? [];
        if (!previous && modifiers.some((modifier) => modifier.enabled)) throw new Error("Disable modifiers before extruding, so the selection matches the base mesh");
        const source = previous?.base ?? live?.base ?? mesh.geometry;
        const [x, y, z] = command.offset;
        if (x === undefined || y === undefined || z === undefined) throw new Error("Extrude offset must move the selection");
        const extruded = extrudeRegion(readTopology(source), command.kind, command.ids, new Vector3(x, y, z));
        const base = writeExtrudedGeometry(source, extruded);
        let display = base;
        try {
          if (modifiers.length > 0) display = evaluateBase(base, modifiers);
        } catch (error) {
          base.dispose();
          throw error;
        }
        if (previous) {
          if (previous.base !== live?.base && previous.base !== mesh.geometry) previous.base.dispose();
          if (previous.display !== previous.base && previous.display !== mesh.geometry && previous.display !== live?.geometry) previous.display.dispose();
        }
        staged.set(mesh, { base, display, modifiers, reveal: (previous?.reveal ?? false) || command.kind !== "face" });
        let total = 0;
        for (const state of staged.values()) total += (state.display.index?.count ?? state.display.getAttribute("position")?.count ?? 0) / 3;
        if (total > 200_000) throw new Error("Geometry batch exceeds the 200000-triangle limit; split it into smaller proposals");
      }
    } catch (error) {
      release();
      const reason = (error instanceof Error ? error.message : "Geometry operation failed").slice(0, 400);
      return { status: "failed" as const, revision: this.revision, message: reason, results: commands.map((command) => ({
        commandId: command.commandId, status: "failed" as const, message: command === current ? reason : "Not applied: the batch was rolled back",
      })) };
    }
    const replaced = new Set<BufferGeometry>();
    for (const [mesh, state] of staged) {
      const live = modifierStack(mesh);
      replaced.add(mesh.geometry);
      if (live) { replaced.add(live.base); replaced.add(live.geometry); }
      if (live || state.modifiers.length > 0) commitStack(mesh, { base: state.base, modifiers: state.modifiers, geometry: state.display });
      else mesh.geometry = state.base;
      if (state.reveal) revealExtrudeBackfaces(mesh);
      replaced.delete(state.base);
      replaced.delete(state.display);
    }
    const used = new Set<BufferGeometry>();
    this.scene.traverse((node) => { if (isMesh(node)) used.add(node.geometry); });
    for (const geometry of replaced) if (!used.has(geometry)) geometry.dispose();
    this.revision += 1;
    this.applied.add(proposalId);
    this.notify();
    return { status: "applied" as const, revision: this.revision, results };
  }

  /** Build every replacement first, then swap buffers together; scene objects and materials retain identity. */
  private applyGeometryBatch(proposalId: string, commands: Command[], results: { commandId: string; status: "applied" }[]) {
    const staged = new Map<Mesh, ModifierStackState>();
    let current: Command | undefined;
    try {
      if (commands.length > 20 || !commands.every(isGeometryCommand)) throw new Error("Geometry batches accept only bevel/subdivision commands, at most 20; create or transform objects in a separate proposal");
      for (const command of commands) {
        current = command;
        const mesh = meshAtPath(this.objects.get(command.objectId), command.meshPath);
        assertEditableMesh(mesh);
        const previous = staged.get(mesh);
        const existing = previous ?? modifierStack(mesh);
        const entries = existing?.modifiers ?? [];
        let id = command.commandId;
        for (let suffix = 1; entries.some((entry) => entry.id === id); suffix += 1) id = `${command.commandId.slice(0, 50)}_${suffix}`;
        const modifiers = command.type === "geometry.set_modifiers" ? command.modifiers : [...entries, command.type === "geometry.bevel"
          ? { id, kind: "bevel" as const, enabled: true, width: command.width, segments: command.segments ?? 1, ...(command.profile ? { profile: command.profile } : {}), ...(command.angle === undefined ? {} : { angle: command.angle }) }
          : { id, kind: "subdivision" as const, enabled: true, levels: command.levels, ...(command.method ? { method: command.method } : {}) }];
        if (modifiers.length > 8) throw new Error("A mesh supports at most eight modifiers");
        const next = evaluateStack(mesh, modifiers, existing);
        staged.set(mesh, next);
        previous?.geometry.dispose();
        let total = 0;
        for (const state of staged.values()) total += (state.geometry.index?.count ?? state.geometry.getAttribute("position").count) / 3;
        if (total > 200_000) throw new Error("Geometry batch exceeds the 200000-triangle limit; split it into smaller proposals");
      }
    } catch (error) {
      for (const [mesh, state] of staged) { state.geometry.dispose(); if (state.base !== modifierStack(mesh)?.base) state.base.dispose(); }
      const reason = (error instanceof Error ? error.message : "Geometry operation failed").slice(0, 400);
      return { status: "failed", revision: this.revision, message: reason, results: commands.map((command) => ({
        commandId: command.commandId, status: "failed" as const, message: command === current ? reason : "Not applied: the batch was rolled back",
      })) };
    }
    const replaced = new Set<BufferGeometry>();
    for (const [mesh, state] of staged) { replaced.add(mesh.geometry); commitStack(mesh, state); }
    const used = new Set<BufferGeometry>();
    this.scene.traverse((node) => { if (isMesh(node)) used.add(node.geometry); });
    for (const geometry of replaced) if (!used.has(geometry)) geometry.dispose();
    this.revision += 1; this.applied.add(proposalId); this.notify();
    return { status: "applied", revision: this.revision, results };
  }

  /**
   * Applies a batch of transforms and deletions straight to the objects. The whole batch is checked
   * first, following what the scene will look like as it goes, and nothing checked can fail when it
   * runs, so the batch is applied whole or not at all without staging a copy of the scene. The cost
   * follows the batch, not the scene.
   */
  private applyInPlace(
    proposalId: string,
    commands: readonly InPlaceCommand[],
    results: { commandId: string; status: "applied" }[],
  ) {
    const gone = new Set<string>();
    const fail = (failed: InPlaceCommand, reason: string) => ({
      status: "failed",
      revision: this.revision,
      results: commands.map((command) => ({
        commandId: command.commandId,
        status: "failed" as const,
        message: command === failed ? reason : "Not applied: the batch was rolled back",
      })),
      message: `The batch was rolled back: command ${failed.commandId} failed. ${reason}`,
    });
    for (const command of commands) {
      const object = this.objects.get(command.objectId);
      if (!object || gone.has(command.objectId))
        return fail(command, `Object "${command.objectId}" does not exist`);
      if (command.type !== "scene.delete_object") continue;
      // An object can only go once whatever hangs below it has gone, earlier in the same batch or before.
      for (const child of object.children) {
        const childId = this.ids.get(child);
        if (childId !== undefined && !gone.has(childId))
          return fail(command, `Delete the children of "${command.objectId}" before deleting it`);
      }
      gone.add(command.objectId);
    }
    for (const command of commands) {
      const object = this.objects.get(command.objectId);
      if (!object) continue;
      if (command.type === "scene.delete_object") this.removeObject(command.objectId, object);
      else this.change(object, command);
    }
    this.revision += 1;
    this.applied.add(proposalId);
    this.pruneSelection();
    this.notify();
    return { status: "applied", revision: this.revision, results };
  }

  /** Takes an object out of the scene and frees what it and its inner parts held. */
  private removeObject(id: string, object: Object3D) {
    // Whatever is still attached is the imported model's own parts, since scene objects below it went first.
    const parts = object.children;
    object.children = [];
    for (const part of parts) {
      part.parent = null;
      part.traverse((node) => this.dispose(node));
    }
    object.removeFromParent();
    this.dispose(object);
    this.objects.delete(id);
  }

  private apply(objects: Map<string, Object3D>, command: Command) {
    if (isGeometryCommand(command)) throw new Error("Geometry commands require a separate geometry batch");
    if (isExtrudeCommand(command)) throw new Error("Extrude commands require a separate extrude batch");
    const existing = objects.get(command.objectId);
    if (command.type === "scene.delete_object") {
      if (!existing) throw new Error(`Object "${command.objectId}" does not exist`);
      for (const child of existing.children) {
        const id = [...objects].find(([, object]) => object === child)?.[0];
        if (id) throw new Error(`Delete the children of "${command.objectId}" before deleting it`);
      }
      existing.removeFromParent();
      objects.delete(command.objectId);
      return;
    }
    if (
      command.type === "scene.transform_object" ||
      command.type === "scene.rename_object" ||
      command.type === "scene.set_visibility"
    ) {
      if (!existing) throw new Error(`Object "${command.objectId}" does not exist`);
      this.change(existing, command);
      return;
    }
    if (command.type === "scene.set_parent") {
      if (!existing) throw new Error(`Object "${command.objectId}" does not exist`);
      const parent = command.parentId === null ? undefined : objects.get(command.parentId);
      if (command.parentId !== null && !parent) throw new Error(`Parent "${command.parentId}" does not exist`);
      this.reparent(existing, parent);
      return;
    }
    if (
      existing &&
      !(command.type === "geometry.create_primitive" && command.replaceExisting)
    )
      throw new Error(
        `Object "${command.objectId}" already exists; use another objectId or set replaceExisting`,
      );
    let object: Object3D;
    if (command.type === "geometry.create_primitive") {
      const size = command.size;
      const geometry: BufferGeometry =
        command.primitive === "sphere"
          ? new SphereGeometry(size / 2, 24, 16)
          : command.primitive === "cylinder"
            ? new CylinderGeometry(size / 2, size / 2, size, 24)
            : command.primitive === "cone"
              ? new ConeGeometry(size / 2, size, 24)
              : command.primitive === "torus"
                ? new TorusGeometry(size * .35, size * .15, 12, 32)
            : command.primitive === "plane"
              ? new PlaneGeometry(size, size)
              : new BoxGeometry(size, size, size);
      object = new Mesh(
        geometry,
        new MeshStandardMaterial({ color: "#b6aaa4", roughness: 0.65, side: command.primitive === "plane" ? DoubleSide : FrontSide }),
      );
      object.name = command.primitive;
    } else {
      object = new Group();
      object.name = command.name;
      if (command.transform) this.transform(object, command.transform);
    }
    if (existing) {
      // Replacing a shape keeps the object's name, place and position in the hierarchy.
      object.name = existing.name;
      object.position.copy(existing.position);
      object.quaternion.copy(existing.quaternion);
      object.scale.copy(existing.scale);
      for (const child of [...existing.children]) object.add(child);
      existing.parent?.add(object);
      existing.removeFromParent();
    }
    objects.set(command.objectId, object);
    if (command.type === "scene.create_object" && command.parentId) {
      const parent = objects.get(command.parentId);
      if (!parent || parent === object)
        throw new Error(`Parent "${command.parentId}" does not exist`);
      parent.add(object);
    }
  }
  /** Applies a command that changes one existing object's own properties. */
  private change(object: Object3D, command: ObjectChange) {
    switch (command.type) {
      case "scene.transform_object":
        this.transform(object, command.transform);
        break;
      case "scene.rename_object":
        object.name = command.name;
        break;
      case "scene.set_visibility":
        object.visible = command.visible;
        break;
    }
  }

  /**
   * Moves an object under another object, or to the top level, without moving it in the world: its own place
   * is changed to make up for the new parent's. An object cannot go under itself or under anything below it.
   */
  private reparent(object: Object3D, parent: Object3D | undefined) {
    for (let above: Object3D | null | undefined = parent; above; above = above.parent)
      if (above === object)
        throw new Error("An object cannot be placed under itself or under something that hangs below it");
    object.updateWorldMatrix(true, false);
    const world = object.matrixWorld.clone();
    object.removeFromParent();
    if (!parent) {
      assignLocalMatrix(object, world, false);
      return;
    }
    parent.updateWorldMatrix(true, false);
    if (Math.abs(parent.matrixWorld.determinant()) < 1e-12) throw new Error("Parent transform cannot be inverted");
    parent.add(object);
    assignLocalMatrix(object, new Matrix4().copy(parent.matrixWorld).invert().multiply(world), false);
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
  /**
   * Hands parts to another object in a single pass. The caller has already taken them out of their old
   * parent, so none of them has to be searched for there: adding them one at a time through three.js
   * makes every part a search of the old list, which is quadratic for a model of thousands of parts.
   */
  private adopt(to: Object3D, children: readonly Object3D[]) {
    for (const child of children) {
      child.parent = to;
      to.children.push(child);
    }
  }

  /** Frees everything under `root`, which must not be shared with anything that stays in the scene. */
  private disposeTree(root: Object3D) {
    root.removeFromParent();
    root.traverse((node) => this.dispose(node));
  }
  private dispose(object: Object3D) {
    if (isMesh(object)) {
      disposeModifierStack(object);
      const geometry: BufferGeometry = object.geometry;
      geometry.dispose();
      const material: Material | Material[] = object.material;
      const materials = Array.isArray(material)
        ? material
        : [material];
      materials.forEach((entry) => entry.dispose());
      if (object instanceof SkinnedMesh) object.skeleton.dispose();
    }
  }
}
