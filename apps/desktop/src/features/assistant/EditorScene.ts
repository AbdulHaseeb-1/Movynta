import {
  DoubleSide,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  SkinnedMesh,
  Vector3,
  type BufferGeometry,
  type Material,
  type Object3D,
  type Quaternion,
  type Scene,
} from "three";
import { CollectionModel, editorCommandListSchema, isWithinBranch, resolveMeshPath, resolveSiblingName, SiblingNames, stableMeshPath, type CollectionEntry, type designFocusSchema, type MeshModifierSpec } from "@movynta/editor-protocol";
import type { z } from "zod";
import { sceneBounds } from "./sceneBounds";
import { measureScene } from "./measureScene";
import type { MeasurementAnnotation, MeasurementRequest, MeasurementUnits } from "@movynta/editor-protocol";
import { Scene as ThreeScene } from "three";
import { clone as cloneSkeleton } from "three/addons/utils/SkeletonUtils.js";
import { duplicateHierarchy, hierarchyBytes } from "../objectEditing/duplicateHierarchy";
import { extrudeAlongRegionNormal, extrudeRegion, writeExtrudedGeometry, type ExtrudeResult } from "../meshGeometry/meshExtrude";
import { subdivideFaces } from "../meshGeometry/meshSubdivideFaces";
import { insetFaces } from "../meshGeometry/meshInset";
import { bevelSurface } from "../meshGeometry/meshBevel";
import { fillHole } from "../meshGeometry/meshFillHole";
import { createPrimitive } from "../meshGeometry/createPrimitive";
import { createPolygonMesh } from "../meshGeometry/createPolygonMesh";
import { mergeVertices } from "../meshGeometry/meshMerge";
import { dissolveEdges } from "../meshGeometry/meshDissolve";
import { slideEdges } from "../meshGeometry/meshSlide";
import { loopCut } from "../meshGeometry/meshLoopCut";
import { applyMaterialEdit, assignMaterial, isMaterialEdit, materialSlots } from "../materials";
import { transformComponents } from "../meshGeometry/meshComponentTransform";
import { transformFaces } from "../meshGeometry/meshFaceTransform";
import { cageKey, copyTopology, readTopology, retainsFaces, type PolygonMesh } from "../meshGeometry/meshTopology";
import { assignLocalMatrix, settleShear } from "../objectEditing/shearFit";
import { assertEditableMesh, inspectMesh, meshAtPath, evaluateStack, evaluateBase, modifierStack, commitStack, copyModifierStack, disposeModifierStack, type ModifierStackState } from "../meshGeometry";
import { evaluateAffected, needsBooleanEvaluation, sceneMeshes, type MeshChange } from "../meshGeometry/booleanEvaluation";
import { ensureManifold } from "../meshGeometry/meshBoolean";
import type { MeshInspectionRequest } from "@movynta/editor-protocol";

export type { CollectionEntry };

/** What the user is doing with the design tools, as the assistant is told about it. */
export type DesignFocus = z.infer<typeof designFocusSchema>;

type Command = z.infer<typeof editorCommandListSchema>[number];
type GeometryCommand = Extract<Command, { type: "geometry.bevel" | "geometry.subdivide" | "geometry.set_modifiers" | "geometry.boolean" }>;
/** Commands that rewrite the base cage of one mesh part. They share a batch and the same rules about modifiers. */
type CageEditCommand = Extract<Command, { type: "geometry.extrude" | "geometry.inset_faces" | "geometry.bevel_edges" | "geometry.subdivide_faces" | "geometry.fill_hole" | "material.assign" | "geometry.merge_vertices" | "geometry.dissolve_edges" | "geometry.slide_edges" | "geometry.loop_cut" | "geometry.transform_components" | "geometry.transform_faces" }>;
function isGeometryCommand(command: Command): command is GeometryCommand {
  return command.type === "geometry.bevel" || command.type === "geometry.subdivide" || command.type === "geometry.set_modifiers" || command.type === "geometry.boolean";
}
function isCageEditCommand(command: Command): command is CageEditCommand {
  return command.type === "material.assign" || command.type === "geometry.extrude" || command.type === "geometry.inset_faces" || command.type === "geometry.bevel_edges" || command.type === "geometry.subdivide_faces" || command.type === "geometry.fill_hole" || command.type === "geometry.transform_faces" || command.type === "geometry.merge_vertices" || command.type === "geometry.dissolve_edges" || command.type === "geometry.slide_edges" || command.type === "geometry.loop_cut" || command.type === "geometry.transform_components";
}
/** Rewrites the base cage for one command: extrude moves a region, subdivide-faces splits only the selected faces. */
function cageEdit(command: CageEditCommand, cage: PolygonMesh, mesh: Mesh, source: BufferGeometry): ExtrudeResult {
  if (command.type === "geometry.bevel_edges") return { mesh: bevelSurface(cage, command.width, command.segments, command.profile, 0, command.ids), selection: [], walls: [] };
  if (command.type === "material.assign") {
    if (!materialSlots(mesh)[command.slot]) throw new Error("Material slot does not exist; inspect materials first");
    return assignMaterial(cage, command.ids, command.slot);
  }
  if (command.type === "geometry.merge_vertices") return mergeVertices(cage, command.ids, command.mode);
  if (command.type === "geometry.dissolve_edges") return dissolveEdges(cage, command.ids, source);
  if (command.type === "geometry.slide_edges") return slideEdges(cage, command.ids, command.rails, command.factor);
  if (command.type === "geometry.loop_cut") return loopCut(cage, command.edge, command.cuts, command.factor);
  if (command.type === "geometry.subdivide_faces") return subdivideFaces(cage, command.ids);
  if (command.type === "geometry.inset_faces") return insetFaces(cage, command.ids, command);
  if (command.type === "geometry.fill_hole") return fillHole(cage, command.ids);
  if (command.type === "geometry.transform_components") {
    mesh.updateWorldMatrix(true, false);
    return transformComponents(cage, command.kind, command.ids, command.transform,
      command.space === "world" ? mesh.matrixWorld : undefined, command.pivot);
  }
  if (command.type === "geometry.transform_faces") {
    mesh.updateWorldMatrix(true, false);
    return transformFaces(cage, command.ids, command.transform, command.space === "world" ? mesh.matrixWorld : undefined);
  }
  const step = (surface: PolygonMesh, ids: string[]) => command.normalDistance !== undefined
    ? extrudeAlongRegionNormal(surface, ids, command.normalDistance, command)
    : extrudeRegion(surface, command.kind, ids, new Vector3().fromArray(command.offset ?? []), command);
  let result = step(cage, command.ids);
  const walls = [...result.walls];
  for (let i = 1; i < (command.steps ?? 1); i += 1) {
    result = step(result.mesh, result.selection);
    walls.push(...result.walls);
  }
  return { ...result, walls };
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

/** What a list of the scene's objects needs to show about each one. */
export interface OutlineEntry {
  id: string;
  name: string;
  kind: "mesh" | "empty";
  /** The object it hangs under, or null at the top level. */
  parentId: string | null;
  /** The object's own flag. It is drawn only if every object above it, and every collection it is in, is visible too. */
  visible: boolean;
  /** The collection it is in, or null for the scene itself. */
  collectionId: string | null;
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
  { type: "scene.transform_object" | "scene.move_object" | "scene.delete_object" | "scene.rename_object" | "scene.set_visibility" }
>;
/** The commands that change one existing object's own properties, without touching the hierarchy. */
type ObjectChange = Extract<Command, { type: "scene.transform_object" | "scene.move_object" | "scene.rename_object" | "scene.set_visibility" }>;
/** A command the batch applied. `name` is the name an object ended up with, which can differ from the one asked for. */
interface AppliedResult {
  commandId: string;
  status: "applied";
  name?: string;
}
function isInPlace(command: Command): command is InPlaceCommand {
  return (
    command.type === "scene.transform_object" ||
    command.type === "scene.move_object" ||
    command.type === "scene.delete_object" ||
    command.type === "scene.rename_object" ||
    command.type === "scene.set_visibility"
  );
}
/** The commands that change collections, or which collection an object is in. They never change where anything is. */
type CollectionCommand = Extract<
  Command,
  { type: "scene.create_collection" | "scene.rename_collection" | "scene.set_collection_visibility" | "scene.move_collection" | "scene.delete_collection" | "scene.move_to_collection" }
>;
function isCollectionCommand(command: Command): command is CollectionCommand {
  return (
    command.type === "scene.create_collection" ||
    command.type === "scene.rename_collection" ||
    command.type === "scene.set_collection_visibility" ||
    command.type === "scene.move_collection" ||
    command.type === "scene.delete_collection" ||
    command.type === "scene.move_to_collection"
  );
}

/**
 * An object is drawn when its own flag is on and so is that of every collection it is in. three.js has one flag, so it
 * holds the result (`object.visible`, which picking, selecting and drawing already read) and the object's own flag is
 * kept in `userData`. An object that was never hidden by a collection has no record: its flag is the one three.js has.
 */
const OWN_VISIBLE = "ownVisible";
function storedOwnVisible(object: Object3D): unknown {
  return object.userData[OWN_VISIBLE];
}
function ownVisible(object: Object3D): boolean {
  const own = storedOwnVisible(object);
  return typeof own === "boolean" ? own : object.visible;
}
function isMesh(object: Object3D | undefined): object is Mesh {
  return object instanceof Mesh;
}
function triangleCount(geometry: BufferGeometry): number {
  return (geometry.index?.count ?? geometry.getAttribute("position")?.count ?? 0) / 3;
}

/** Applies only the closed editor protocol. Batches are staged and committed atomically. */
export class EditorScene {
  private measurementUnits: MeasurementUnits = null;
  private measurementAnnotations: MeasurementAnnotation[] = [];
  setMeasurementUnits(units: MeasurementUnits, annotations: MeasurementAnnotation[] = []) {
    this.measurementUnits = units;
    this.measurementAnnotations = annotations;
  }

  measure(request: MeasurementRequest) {
    this.beginChange();
    this.scene.updateMatrixWorld(true);
    return measureScene(request, (id) => this.objects.get(id), this.revision);
  }
  private objects = new Map<string, Object3D>();
  private readonly applied = new Set<string>();
  private revision = 0;
  /**
   * Counts the changes to the scene itself: it goes up for a batch, an import, a restore or a reset, and not for a
   * selection. A list of the objects stays valid while it is unchanged; the revision cannot say so because a
   * reset starts it again from 0.
   */
  private structureVersion = 0;
  /** The collections, and which one each object is in. An object it does not know is in the scene itself. */
  private collectionModel = new CollectionModel();
  private prepared: { id: string; revision: number; candidate: EditorScene } | undefined;
  private recoveryNeeded = false;
  get requiresRecovery(): boolean { return this.recoveryNeeded; }
  requireRecovery(): void { this.recoveryNeeded = true; }
  private readonly scene: Scene;
  private boundProjectId: string;
  /** The selected objects in the order they were chosen; the last one is the active object. */
  private selected: readonly string[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly changeStarts = new Set<() => void>();
  private focus: DesignFocus = { mode: "object", componentKind: null, componentSelection: null };
  private focusRevision = 0;
  /** Each registered object's id, so finding it from the object never has to search. */
  private ids = new WeakMap<Object3D, string>();
  private readonly idLookup: IdLookup = { has: (id) => this.objects.has(id) };
  private booleanPreviewing = false;
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

  /** Changes whenever the objects, their names, parents or visibility may have changed, never for a selection. */
  get version(): number {
    return this.structureVersion;
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

  private notify(structural = true) {
    if (structural) this.structureVersion += 1;
    for (const listener of this.listeners) listener();
  }

  /**
   * Calls `listener` before a change, a prepared fork or an inspection reads the displayed geometry, so it can end a
   * preview that is on screen. Those paths must build on the committed geometry, not on a preview.
   */
  onBeforeChange(listener: () => void): () => void {
    this.changeStarts.add(listener);
    return () => this.changeStarts.delete(listener);
  }

  private beginChange() {
    for (const listener of this.changeStarts) listener();
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
    this.notify(false);
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
    this.collectionModel = candidate.collectionModel;
    for (const id of candidate.applied) this.applied.add(id);
    const roots = [...candidate.scene.children];
    for (const root of roots) this.scene.add(root);
    this.revision = revision;
    this.recoveryNeeded = false;
    this.selected = selection.filter((id) => this.objects.has(id));
    candidate.objects = new Map();
    candidate.ids = new WeakMap();
    candidate.collectionModel = new CollectionModel();
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
    candidate.collectionModel = this.collectionModel.clone();
    candidate.selected = [...this.selected]; candidate.revision = this.revision;
    for (const id of this.applied) candidate.applied.add(id);
    return candidate;
  }

  /** Inspect a disposable candidate without holding a prepared commit open. */
  withProposalPreview<T>(
    proposalId: string,
    revision: number,
    commands: unknown,
    read: (scene: Scene, candidate: EditorScene) => T,
  ): T {
    if (this.prepared || this.requiresRecovery) throw new Error("Finish the pending scene change before previewing a proposal");
    if (revision !== this.revision) throw new Error("Scene changed since this proposal was created. Inspect it and propose again.");
    this.beginChange();
    const candidate = this.fork();
    try {
      const result = candidate.execute(proposalId, revision, commands);
      if (result.status !== "applied") {
        throw new Error("message" in result && result.message ? result.message : "The proposal could not be previewed");
      }
      return read(candidate.scene, candidate);
    } finally {
      candidate.reset();
    }
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
    this.beginChange();
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
    const containsBoolean = steps.some((step) => {
      if (step.kind !== "commands") return false;
      const commands = editorCommandListSchema.safeParse(step.commands);
      return commands.success && commands.data.some((command) =>
        command.type === "geometry.boolean" ||
        (command.type === "geometry.set_modifiers" && command.modifiers.some((modifier) => modifier.kind === "boolean" && modifier.enabled)),
      );
    });
    if (containsBoolean) await ensureManifold();
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
    this.beginChange();
    this.discardPrepared();
    for (const object of this.objects.values()) this.disposeTree(object);
    this.objects = new Map();
    this.ids = new WeakMap();
    this.collectionModel = new CollectionModel();
    this.applied.clear();
    this.revision = 0;
    this.selected = [];
    this.focus = { ...this.focus, componentSelection: null };
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
    this.beginChange();
    // A model imported twice keeps both, under names that differ. A name that cannot be made unique is left as it is.
    const named = resolveSiblingName(object.name.slice(0, 72), this.siblingNames(this.objects, null));
    if (named.ok && object.name.length > 0) object.name = named.name;
    this.objects.set(objectId, object);
    this.ids.set(object, objectId);
    if (!object.parent) this.scene.add(object);
    this.revision += 1;
    this.notify();
  }

  /** Mirrors the workspace's design mode and Edit-mode picks, so the assistant can see what the user has selected. */
  setDesignFocus(focus: DesignFocus): void {
    this.focus = focus;
    this.focusRevision = this.revision;
  }

  /** The focus as the assistant should see it: the picked mesh is checked, and a stale pick is dropped. */
  private designFocusSnapshot(): DesignFocus {
    const selection = this.focus.componentSelection;
    if (!selection) return this.focus;
    if (this.focusRevision !== this.revision) return { ...this.focus, componentSelection: null };
    const object = this.objects.get(selection.objectId);
    if (!object) return { ...this.focus, componentSelection: null };
    try {
      const mesh = meshAtPath(object, selection.meshPath);
      const stack = modifierStack(mesh);
      const modifiersEnabled = stack?.modifiers.some((modifier) => modifier.enabled) ?? false;
      let baseFaceIds: string[] | undefined;
      if (modifiersEnabled && selection.kind === "face" && selection.ids.length > 0 && mesh.geometry === stack?.geometry) {
        const sources = readTopology(mesh.geometry).faceSources;
        if (sources) {
          const mapped = selection.ids.map((id) => sources[Number(id)] ?? -1);
          if (mapped.every((id) => id >= 0)) baseFaceIds = [...new Set(mapped.map(String))];
        }
      }
      return {
        ...this.focus,
        componentSelection: {
          // By part name where parts have one, so the assistant's reference to the picked part survives other parts changing.
          objectId: selection.objectId, meshPath: stableMeshPath(object, selection.meshPath), kind: selection.kind, ids: selection.ids,
          modifiersEnabled, ...(baseFaceIds ? { baseFaceIds } : {}),
        },
      };
    } catch {
      return { ...this.focus, componentSelection: null };
    }
  }

  /** Every object with just what a list shows, without the bounds and mesh work `context` does. */
  outline(): OutlineEntry[] {
    const entries: OutlineEntry[] = [];
    for (const [id, object] of this.objects) {
      const parent = object.parent;
      entries.push({
        id,
        name: object.name,
        kind: object instanceof Mesh ? "mesh" : "empty",
        parentId: parent && parent !== this.scene ? (this.ids.get(parent) ?? null) : null,
        visible: ownVisible(object),
        collectionId: this.collectionModel.collectionOf(id),
      });
    }
    return entries;
  }

  /** The collections, for a list of the scene. */
  collections(): CollectionEntry[] {
    return this.collectionModel.entries();
  }

  context(inspection?: MeshInspectionRequest, measurement?: MeasurementRequest) {
    const measured = measurement ? this.measure(measurement) : undefined;
    this.scene.updateMatrixWorld(true);
    // Inspection names components on the committed cage, which is what the next edit will change.
    if (inspection) this.beginChange();
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
        visible: ownVisible(object),
        collectionId: this.collectionModel.collectionOf(id),
        worldBounds: box && !box.isEmpty() ? { min: box.min.toArray(), max: box.max.toArray() } : null,
      });
    }
    return {
      projectId: this.projectId,
      revision: this.revision,
      activeSceneName: "Main",
      selectedObjectIds: this.selected.slice(-500),
      objects,
      collections: this.collectionModel.entries(),
      supportsPreparedCommands: true,
      supportsSceneGraph: true,
      supportsCollections: true,
      supportsRepetition: true,
      measurementUnits: this.measurementUnits,
      measurementAnnotations: this.measurementAnnotations,
      ...(measured ? { measurement: measured } : {}),
      designFocus: this.designFocusSnapshot(),
      ...(inspection ? { meshInspection: inspectMesh(this.objects.get(inspection.objectId), inspection) } : {}),
    };
  }

  /**
   * Recomputes boolean results from the matrices currently on the objects.
   * Used while a move, rotate, or scale is still a preview. A failure keeps the last valid meshes.
   */
  previewBooleans(): string | undefined {
    if (this.booleanPreviewing || this.recoveryNeeded || this.prepared || !this.hasEnabledBoolean()) return undefined;
    this.booleanPreviewing = true;
    let evaluated: Map<Mesh, ModifierStackState> | undefined;
    try {
      this.scene.updateMatrixWorld(true);
      const slots = sceneMeshes(this.objects);
      const selected = new Set(this.selected.map((id) => this.objects.get(id)));
      const transformed = new Set(slots.filter(({ mesh }) => {
        for (let node: Object3D | null = mesh; node; node = node.parent) if (selected.has(node)) return true;
        return false;
      }).map(({ mesh }) => mesh));
      evaluated = evaluateAffected(slots, new Map(), "transforms", transformed);
      this.assertTriangleBudget(evaluated);
      this.commitMeshResults(evaluated);
    } catch (error) {
      this.discardGeometries(evaluated);
      return error instanceof Error ? error.message : "Boolean preview failed";
    } finally {
      this.booleanPreviewing = false;
    }
    return undefined;
  }

  /**
   * Moves the inner parts of each imported model from the object to its copy, so that a Boolean that uses one of them
   * can be worked out on the copies. Only parts that are not scene objects are moved, and each object keeps its
   * place among its parents' children. Returns what hands them back exactly as they were, for a batch that fails.
   * When the batch goes through, the parts stay with the copies, which is where they were going.
   */
  private borrowInnerParts(staged: ReadonlyMap<string, Object3D>, copiedFrom: ReadonlyMap<Object3D, Object3D>): () => void {
    const registered = new Set(this.objects.values());
    const borrowed: { object: Object3D; replacement: Object3D; children: Object3D[]; inner: Object3D[] }[] = [];
    for (const [id, object] of this.objects) {
      const replacement = staged.get(id);
      // An object that the batch replaced with another shape drops its parts, as it always has.
      if (!replacement || copiedFrom.get(replacement) !== object) continue;
      const inner = object.children.filter((child) => !registered.has(child));
      if (inner.length === 0) continue;
      borrowed.push({ object, replacement, children: [...object.children], inner });
      object.children = object.children.filter((child) => registered.has(child));
      this.adopt(replacement, inner);
    }
    return () => {
      for (const { object, replacement, children, inner } of borrowed) {
        const parts = new Set(inner);
        replacement.children = replacement.children.filter((child) => !parts.has(child));
        object.children = children;
        for (const part of inner) part.parent = object;
      }
    };
  }

  /**
   * A Boolean's operand path in the form that keeps leading to the same part: names where parts have them. A path
   * written with child indexes means whatever is at that position, and the position of a part changes when something
   * is put in front of the parts or taken away, which would point the Boolean at another part without a word.
   * An unnamed part has only its index to go by, and a path that leads nowhere is left for the evaluation to report.
   */
  private pinOperands(modifiers: readonly MeshModifierSpec[]): MeshModifierSpec[] {
    return modifiers.map((modifier) => {
      if (modifier.kind !== "boolean" || !modifier.operandMeshPath.some((step) => typeof step === "number")) return modifier;
      const root = this.objects.get(modifier.operandObjectId);
      if (!root || resolveMeshPath(root, modifier.operandMeshPath) === undefined) return modifier;
      const pinned = stableMeshPath(root, modifier.operandMeshPath);
      return pinned.every((step, index) => step === modifier.operandMeshPath[index]) ? modifier : { ...modifier, operandMeshPath: pinned };
    });
  }

  private hasEnabledBoolean(objects: ReadonlyMap<string, Object3D> = this.objects): boolean {
    return sceneMeshes(objects).some((slot) => (modifierStack(slot.mesh)?.modifiers ?? []).some((modifier) => modifier.enabled && modifier.kind === "boolean"));
  }

  private operandReferenced(objectId: string): boolean {
    for (const slot of sceneMeshes(this.objects)) {
      if (slot.objectId === objectId) continue;
      if ((modifierStack(slot.mesh)?.modifiers ?? []).some((modifier) => modifier.kind === "boolean" && modifier.operandObjectId === objectId)) return true;
    }
    return false;
  }

  private captureTransforms(): Map<Object3D, { position: Vector3; quaternion: Quaternion; scale: Vector3 }> {
    const snapshot = new Map<Object3D, { position: Vector3; quaternion: Quaternion; scale: Vector3 }>();
    for (const object of this.objects.values()) snapshot.set(object, { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() });
    return snapshot;
  }

  private restoreTransforms(snapshot: ReadonlyMap<Object3D, { position: Vector3; quaternion: Quaternion; scale: Vector3 }>): void {
    for (const [object, transform] of snapshot) {
      object.position.copy(transform.position);
      object.quaternion.copy(transform.quaternion);
      object.scale.copy(transform.scale);
    }
  }

  private assertTriangleBudget(evaluated: ReadonlyMap<Mesh, ModifierStackState>): void {
    let total = 0;
    for (const state of evaluated.values()) total += triangleCount(state.geometry);
    if (total > 200_000) throw new Error("Geometry batch exceeds the 200000-triangle limit; split it into smaller proposals");
  }

  private commitMeshResults(evaluated: ReadonlyMap<Mesh, ModifierStackState>): void {
    const replaced = new Set<BufferGeometry>();
    for (const [mesh, state] of evaluated) {
      const live = modifierStack(mesh);
      replaced.add(mesh.geometry);
      if (live) {
        if (live.geometry !== mesh.geometry) replaced.add(live.geometry);
        if (live.base !== state.base) replaced.add(live.base);
      }
      commitStack(mesh, state);
      replaced.delete(state.geometry);
      replaced.delete(state.base);
    }
    this.disposeUnused(replaced);
  }

  private discardGeometries(evaluated: ReadonlyMap<Mesh, ModifierStackState> | undefined): void {
    if (!evaluated) return;
    for (const [mesh, state] of evaluated) {
      const live = modifierStack(mesh);
      if (state.geometry !== mesh.geometry && state.geometry !== live?.geometry && state.geometry !== state.base) state.geometry.dispose();
    }
  }

  private disposeUnused(replaced: ReadonlySet<BufferGeometry>): void {
    const used = new Set<BufferGeometry>();
    this.scene.traverse((node) => { if (isMesh(node)) used.add(node.geometry); });
    for (const geometry of replaced) if (!used.has(geometry)) geometry.dispose();
  }

  private refreshStagedBooleans(objects: ReadonlyMap<string, Object3D>): void {
    if (!this.hasEnabledBoolean(objects)) return;
    for (const object of objects.values()) if (!object.parent) object.updateMatrixWorld(true);
    let evaluated: Map<Mesh, ModifierStackState> | undefined;
    try {
      evaluated = evaluateAffected(sceneMeshes(objects), new Map(), "transforms");
      this.assertTriangleBudget(evaluated);
      this.commitMeshResults(evaluated);
    } catch (error) {
      this.discardGeometries(evaluated);
      throw error;
    }
  }

  execute(proposalId: string, expectedRevision: number, input: unknown) {
    if (this.recoveryNeeded) throw new Error("Reconnect to the saved project before editing");
    if (this.prepared) throw new Error("Wait for the prepared scene change to finish");
    const commands = editorCommandListSchema.parse(input);
    const results: AppliedResult[] = commands.map((command) => ({
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
    this.beginChange();
    for (const command of commands) {
      if (command.type !== "scene.delete_object" || !this.operandReferenced(command.objectId)) continue;
      const reason = `Remove the Boolean modifier that uses "${command.objectId}" before deleting it`;
      return {
        status: "failed",
        revision: this.revision,
        message: reason,
        results: commands.map((entry) => ({
          commandId: entry.commandId,
          status: "failed" as const,
          message: entry === command ? reason : "Not applied: the batch was rolled back",
        })),
      };
    }
    if (commands.some((command) => command.type === "scene.duplicate_hierarchy")) return this.applyDuplication(proposalId, commands, results);
    if (commands.some(isMaterialEdit)) return this.applyMaterialBatch(proposalId, commands, results);
    if (commands.some(isGeometryCommand)) return this.applyGeometryBatch(proposalId, commands, results);
    if (commands.some(isCageEditCommand)) return this.applyCageEditBatch(proposalId, commands, results);
    // Moving, turning, resizing and deleting are the common edits, and need no copy of the scene to be safe.
    if (commands.every(isInPlace)) return this.applyInPlace(proposalId, commands, results);
    // Collections change nothing in space, so a batch of only those needs no copy of the scene.
    if (commands.every(isCollectionCommand)) return this.applyCollectionBatch(proposalId, commands, results);
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
    /** The names under each parent that the batch has added so far, so a run of creations does not rescan the scene. */
    const claims = new Map<Object3D | null, SiblingNames>();
    const model = this.collectionModel.clone();
    /** Hands back the inner parts of imported models that were lent to the copies, if they were. */
    let giveBack: (() => void) | undefined;
    try {
      commands.forEach((command, index) => {
        current = command;
        const name = this.apply(staged, command, claims, model);
        const result = results[index];
        if (name !== undefined && result) result.name = name;
      });
      if (commands.some((command) => command.type === "scene.set_parent" || command.type === "scene.transform_object" || command.type === "scene.move_object" || (command.type === "geometry.create_primitive" && command.replaceExisting))) {
        // A Boolean can use a part inside an imported model, and the copies have none of those parts, so they are
        // lent to the copies while the cuts are worked out. Whether there is a Boolean is asked of the scene as it
        // is, since a batch like this cannot make one.
        if (this.hasEnabledBoolean()) giveBack = this.borrowInnerParts(staged, copiedFrom);
        this.refreshStagedBooleans(staged);
      }
    } catch (error) {
      giveBack?.();
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
    const hadCollections = this.collectionModel.size > 0;
    this.objects = staged;
    this.collectionModel = model;
    for (const [id, object] of staged) this.ids.set(object, id);
    const stagedObjects = new Set(staged.values());
    for (const object of staged.values())
      if (!object.parent || !stagedObjects.has(object.parent))
        this.scene.add(object);
    // Reparent may have left an exact matrix that position, rotation and scale cannot store.
    settleShear(staged.values());
    this.refreshVisibility(hadCollections);
    this.revision += 1;
    this.applied.add(proposalId);
    this.pruneSelection();
    this.notify();
    return { status: "applied", revision: this.revision, results };
  }

  /** Duplicate a complete registered hierarchy in a resource-independent candidate. */
  private applyDuplication(proposalId: string, commands: Command[], results: AppliedResult[]) {
    let candidate: EditorScene | undefined;
    try {
      const command = commands[0];
      if (commands.length !== 1 || command?.type !== "scene.duplicate_hierarchy") throw new Error("Duplicate one hierarchy per proposal");
      const source = this.objects.get(command.sourceId);
      if (!source) throw new Error("Source object does not exist");
      if (hierarchyBytes(this.scene) + hierarchyBytes(source) * command.copies.length > 128 * 1024 * 1024) throw new Error("Copies exceed the 128 MiB geometry budget");
      const ids = command.copies.flatMap((copy) => [copy.objectId, ...copy.descendants.map((entry) => entry.objectId)]);
      if (this.objects.size + ids.length > 2000 || ids.some((id) => this.objects.has(id))) throw new Error("Use fresh object IDs and stay within 2000 scene objects");
      candidate = this.fork();
      const original = candidate.objects.get(command.sourceId);
      if (!original) throw new Error("Source disappeared");
      original.updateWorldMatrix(true, false);
      const delta = new Vector3().fromArray(command.offset);
      if (command.space === "world" && original.parent) {
        if (Math.abs(original.parent.matrixWorld.determinant()) < 1e-12) throw new Error("Cannot convert a world offset through a singular parent");
        const inverse = original.parent.matrixWorld.clone().invert();
        delta.applyMatrix4(inverse).sub(new Vector3().setFromMatrixPosition(inverse));
      }
      for (let index = 0; index < command.copies.length; index++) {
        const spec = command.copies[index]; if (!spec) continue;
        const copy = duplicateHierarchy(original, candidate.objects, command.sourceId, spec);
        (original.parent ?? candidate.scene).add(copy.root);
        for (const [id, object] of copy.objects) { candidate.objects.set(id, object); candidate.ids.set(object, id); }
        const resolved = resolveSiblingName(spec.name ?? (original.name.trim() ? original.name : command.sourceId), candidate.siblingNames(candidate.objects, copy.root.parent, copy.root));
        if (!resolved.ok) throw new Error(resolved.message);
        copy.root.name = resolved.name;
        const offset = delta.clone().multiplyScalar(index + 1);
        copy.root.position.add(offset);
        if (copy.root.matrixAutoUpdate) copy.root.updateMatrix();
        else { copy.root.matrix.elements[12] = (copy.root.matrix.elements[12] ?? 0) + offset.x; copy.root.matrix.elements[13] = (copy.root.matrix.elements[13] ?? 0) + offset.y; copy.root.matrix.elements[14] = (copy.root.matrix.elements[14] ?? 0) + offset.z; copy.root.matrixWorldNeedsUpdate = true; }
        const collectionSources = new Map([[spec.objectId, command.sourceId], ...spec.descendants.map((entry) => [entry.objectId, entry.sourceId] as [string, string])]);
        for (const [id, from] of collectionSources) {
          const refused = candidate.collectionModel.assign(id, candidate.collectionModel.collectionOf(from));
          if (refused) throw new Error(refused);
        }
      }
      candidate.refreshVisibility(); candidate.refreshStagedBooleans(candidate.objects);
      candidate.applied.add(proposalId); this.replaceFrom(candidate);
      return { status: "applied", revision: this.revision, results };
    } catch (error) {
      candidate?.reset(); const message = error instanceof Error ? error.message : "Duplication failed";
      return { status: "failed", revision: this.revision, message, results: results.map((result) => ({ ...result, status: "failed" as const, message })) };
    }
  }

  /** Material edits use the same resource-independent candidate as proposal previews. */
  private applyMaterialBatch(proposalId: string, commands: Command[], results: AppliedResult[]) {
    let candidate: EditorScene | undefined;
    let current: Command | undefined;
    try {
      if (commands.length > 20 || !commands.every(isMaterialEdit)) throw new Error("Use a separate batch of at most 20 material property/slot edits");
      candidate = this.fork();
      for (const command of commands) {
        current = command;
        applyMaterialEdit(meshAtPath(candidate.objects.get(command.objectId), command.meshPath), command);
      }
      candidate.applied.add(proposalId);
      this.replaceFrom(candidate);
      return { status: "applied", revision: this.revision, results };
    } catch (error) {
      candidate?.reset();
      const reason = error instanceof Error ? error.message : "Material edit failed";
      return { status: "failed", revision: this.revision, message: reason,
        results: commands.map((command) => ({ commandId: command.commandId, status: "failed" as const,
          message: command === current ? reason : "Not applied: the batch was rolled back" })) };
    }
  }

  /** Rewrites the base cage, then evaluates the same modifier list. A failure leaves the live mesh untouched. */
  private applyCageEditBatch(proposalId: string, commands: Command[], results: AppliedResult[]) {
    interface Staged { base: BufferGeometry; display: BufferGeometry; modifiers: ModifierStackState["modifiers"]; reveal: boolean }
    const staged = new Map<Mesh, Staged>();
    let current: Command | undefined;
    let dependent: Map<Mesh, ModifierStackState> | undefined;
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
      if (commands.length > 20 || !commands.every(isCageEditCommand)) throw new Error("Use at most 20 component edits per batch; create or transform objects in a separate proposal");
      const refreshDependents = this.hasEnabledBoolean();
      for (const command of commands) {
        current = command;
        const mesh = meshAtPath(this.objects.get(command.objectId), command.meshPath);
        assertEditableMesh(mesh);
        if (mesh instanceof SkinnedMesh) throw new Error("Component edits on skinned meshes are not supported yet.");
        const live = modifierStack(mesh);
        const previous = staged.get(mesh);
        const modifiers = previous?.modifiers ?? live?.modifiers ?? [];
        const topologyChange = command.type === "geometry.bevel_edges" || command.type === "geometry.merge_vertices" || command.type === "geometry.dissolve_edges" || command.type === "geometry.loop_cut";
        if (topologyChange && (commands.length !== 1 || modifiers.some((modifier) => modifier.enabled))) throw new Error("Use one topology edit per proposal and disable modifiers first");
        const liveExtrusion = modifiers.find((modifier) => modifier.kind === "extrusion");
        if (liveExtrusion && command.type !== "geometry.fill_hole" && command.type !== "material.assign" &&
          ((command.type !== "geometry.extrude" && command.type !== "geometry.transform_faces" && command.type !== "geometry.transform_components" && command.type !== "geometry.slide_edges") || (liveExtrusion.componentKind ?? "face") !== "face")) {
          throw new Error("Remove the live extrusion before rewriting its base cage");
        }
        const usesBaseIds = "componentView" in command && command.componentView === "base";
        if (!usesBaseIds && modifiers.some((modifier) => modifier.enabled)) {
          throw new Error("Disable modifiers before editing components, or use explicit base IDs where supported");
        }
        const source = previous?.base ?? live?.base ?? mesh.geometry;
        const cage = readTopology(source);
        if (liveExtrusion && liveExtrusion.baseKey !== cageKey(cage)) {
          throw new Error("The live extrusion's base cage changed. Inspect the base and choose its components again.");
        }
        const extruded = cageEdit(command, cage, mesh, source);
        if (liveExtrusion && (command.type === "geometry.extrude" || command.type === "geometry.transform_faces" || command.type === "geometry.transform_components" || command.type === "geometry.slide_edges") && !retainsFaces(cage, extruded.mesh, liveExtrusion.ids)) {
          throw new Error("This edit changes a face used by the live extrusion. Adjust or remove that modifier first.");
        }
        const base = writeExtrudedGeometry(source, extruded);
        let display = base;
        let nextModifiers = modifiers;
        try {
          if (liveExtrusion) {
            // The edit kept the anchors, so the modifier can bind to the new cage key.
            const baseKey = cageKey(readTopology(base));
            nextModifiers = modifiers.map((modifier) =>
              modifier === liveExtrusion ? { ...liveExtrusion, baseKey } : modifier,
            );
          }
          if (!refreshDependents && nextModifiers.length > 0) display = evaluateBase(base, nextModifiers);
        } catch (error) {
          base.dispose();
          throw error;
        }
        if (previous) {
          if (previous.base !== live?.base && previous.base !== mesh.geometry) previous.base.dispose();
          if (previous.display !== previous.base && previous.display !== mesh.geometry && previous.display !== live?.geometry) previous.display.dispose();
        }
        staged.set(mesh, { base, display, modifiers: nextModifiers, reveal: (previous?.reveal ?? false) || (command.type === "geometry.extrude" && command.kind !== "face") });
        if (!refreshDependents) {
          let total = 0;
          for (const state of staged.values()) total += triangleCount(state.display);
          if (total > 200_000) throw new Error("Geometry batch exceeds the 200000-triangle limit; split it into smaller proposals");
        }
      }
      if (refreshDependents) {
        const changes = new Map<Mesh, MeshChange>();
        for (const [mesh, state] of staged) changes.set(mesh, { base: state.base, modifiers: state.modifiers });
        dependent = evaluateAffected(sceneMeshes(this.objects), changes, "dependencies");
        this.assertTriangleBudget(dependent);
        for (const [mesh, result] of dependent) {
          const state = staged.get(mesh);
          if (state) state.display = result.geometry;
        }
      }
    } catch (error) {
      release();
      this.discardGeometries(dependent);
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
    if (dependent) {
      for (const [mesh, state] of dependent) {
        if (staged.has(mesh)) continue;
        const live = modifierStack(mesh);
        replaced.add(mesh.geometry);
        if (live && live.geometry !== mesh.geometry) replaced.add(live.geometry);
        commitStack(mesh, state);
        replaced.delete(state.geometry);
        replaced.delete(state.base);
      }
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
  private applyGeometryBatch(proposalId: string, commands: Command[], results: AppliedResult[]) {
    const staged = new Map<Mesh, ModifierStackState>();
    let current: Command | undefined;
    let dependent: Map<Mesh, ModifierStackState> | undefined;
    try {
      if (commands.length > 20 || !commands.every(isGeometryCommand)) throw new Error("Use at most 20 modifier commands per batch; create or transform objects in a separate proposal");
      const planned = new Map<Mesh, MeshModifierSpec[]>();
      const touched = new Map<Mesh, Command>();
      for (const command of commands) {
        current = command;
        const mesh = meshAtPath(this.objects.get(command.objectId), command.meshPath);
        assertEditableMesh(mesh);
        const entries = planned.get(mesh) ?? modifierStack(mesh)?.modifiers ?? [];
        let id = command.commandId;
        for (let suffix = 1; entries.some((entry) => entry.id === id); suffix += 1) id = `${command.commandId.slice(0, 50)}_${suffix}`;
        const modifiers = command.type === "geometry.set_modifiers" ? command.modifiers : [...entries, command.type === "geometry.bevel"
          ? { id, kind: "bevel" as const, enabled: true, width: command.width, segments: command.segments ?? 1, ...(command.profile ? { profile: command.profile } : {}), ...(command.angle === undefined ? {} : { angle: command.angle }) }
          : command.type === "geometry.boolean"
            ? { id, kind: "boolean" as const, enabled: true, operation: command.operation,
              operandObjectId: command.operandObjectId, operandMeshPath: command.operandMeshPath,
              ...(command.cutMaterialIndex === undefined ? {} : { cutMaterialIndex: command.cutMaterialIndex }) }
            : { id, kind: "subdivision" as const, enabled: true, levels: command.levels, ...(command.method ? { method: command.method } : {}) }];
        if (modifiers.length > 8) throw new Error("A mesh supports at most eight modifiers");
        planned.set(mesh, this.pinOperands(modifiers));
        touched.set(mesh, command);
      }
      if (needsBooleanEvaluation(sceneMeshes(this.objects), planned)) {
        const changes = new Map<Mesh, MeshChange>();
        for (const [mesh, modifiers] of planned) changes.set(mesh, { modifiers });
        dependent = evaluateAffected(sceneMeshes(this.objects), changes, "dependencies");
        this.assertTriangleBudget(dependent);
      } else {
        for (const [mesh, modifiers] of planned) {
          current = touched.get(mesh);
          const next = evaluateStack(mesh, modifiers, modifierStack(mesh));
          staged.set(mesh, next);
          let total = 0;
          for (const state of staged.values()) total += triangleCount(state.geometry);
          if (total > 200_000) throw new Error("Geometry batch exceeds the 200000-triangle limit; split it into smaller proposals");
        }
      }
    } catch (error) {
      for (const [mesh, state] of staged) { state.geometry.dispose(); if (state.base !== modifierStack(mesh)?.base) state.base.dispose(); }
      this.discardGeometries(dependent);
      const reason = (error instanceof Error ? error.message : "Geometry operation failed").slice(0, 400);
      return { status: "failed", revision: this.revision, message: reason, results: commands.map((command) => ({
        commandId: command.commandId, status: "failed" as const, message: command === current ? reason : "Not applied: the batch was rolled back",
      })) };
    }
    if (dependent) this.commitMeshResults(dependent);
    else {
      const replaced = new Set<BufferGeometry>();
      for (const [mesh, state] of staged) { replaced.add(mesh.geometry); commitStack(mesh, state); }
      this.disposeUnused(replaced);
    }
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
    results: AppliedResult[],
  ) {
    const gone = new Set<string>();
    /** The objects deleted so far in the batch, and the names chosen so far, so each rename sees the batch as it goes. */
    const removed = new Set<Object3D>();
    const renamed = new Map<Object3D, string>();
    const chosen = new Map<InPlaceCommand, string>();
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
      if (command.type === "scene.rename_object") {
        const taken = this.siblingNames(this.objects, object.parent, object, removed, renamed);
        const resolved = resolveSiblingName(command.name, taken);
        if (!resolved.ok) return fail(command, resolved.message);
        renamed.set(object, resolved.name);
        chosen.set(command, resolved.name);
      }
      if (command.type !== "scene.delete_object") continue;
      // An object can only go once whatever hangs below it has gone, earlier in the same batch or before.
      for (const child of object.children) {
        const childId = this.ids.get(child);
        if (childId !== undefined && !gone.has(childId))
          return fail(command, `Delete the children of "${command.objectId}" before deleting it`);
      }
      gone.add(command.objectId);
      removed.add(object);
    }
    const snapshot = commands.some((command) => command.type === "scene.transform_object" || command.type === "scene.move_object") && this.hasEnabledBoolean()
      ? this.captureTransforms()
      : undefined;
    const names = snapshot ? new Map([...this.objects.values()].map((object) => [object, object.name])) : undefined;
    const shown = snapshot ? new Map([...this.objects.values()].map((object) => [object, object.visible])) : undefined;
    const owns = snapshot ? new Map<Object3D, unknown>([...this.objects.values()].map((object) => [object, storedOwnVisible(object)])) : undefined;
    for (const command of commands) {
      const object = this.objects.get(command.objectId);
      if (!object) continue;
      if (command.type === "scene.delete_object") {
        if (!snapshot) this.removeObject(command.objectId, object);
      } else this.change(object, command, chosen.get(command));
    }
    commands.forEach((command, index) => {
      const name = chosen.get(command);
      const result = results[index];
      if (name !== undefined && result) result.name = name;
    });
    if (snapshot) {
      let evaluated: Map<Mesh, ModifierStackState> | undefined;
      try {
        this.scene.updateMatrixWorld(true);
        evaluated = evaluateAffected(sceneMeshes(this.objects), new Map(), "transforms");
        this.assertTriangleBudget(evaluated);
        this.commitMeshResults(evaluated);
      } catch (error) {
        this.discardGeometries(evaluated);
        this.restoreTransforms(snapshot);
        for (const [object, name] of names ?? []) object.name = name;
        for (const [object, visible] of shown ?? []) object.visible = visible;
        for (const [object, own] of owns ?? []) {
          if (own === undefined) delete object.userData[OWN_VISIBLE];
          else object.userData[OWN_VISIBLE] = own;
        }
        this.scene.updateMatrixWorld(true);
        const failed = [...commands].reverse().find((command) => command.type === "scene.transform_object" || command.type === "scene.move_object");
        const reason = (error instanceof Error ? error.message : "Boolean operation failed").slice(0, 400);
        if (failed) return fail(failed, reason);
      }
      for (const command of commands) {
        if (command.type !== "scene.delete_object") continue;
        const object = this.objects.get(command.objectId);
        if (object) this.removeObject(command.objectId, object);
      }
    }
    this.refreshVisibility();
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
    this.collectionModel.forget(id);
  }

  /**
   * Applies one command to the staged objects. Returns the name an object was given when the command created,
   * renamed or moved one, since a name taken by a sibling is made unique and the caller reports what it became.
   */
  private apply(
    objects: Map<string, Object3D>,
    command: Command,
    claims: Map<Object3D | null, SiblingNames> = new Map(),
    model: CollectionModel = this.collectionModel,
  ): string | undefined {
    if (isGeometryCommand(command)) throw new Error("Geometry commands require a separate geometry batch");
    if (isMaterialEdit(command)) throw new Error("Material commands require a separate material batch");
    if (command.type === "scene.duplicate_hierarchy") throw new Error("Duplicate hierarchies in a separate proposal");
    if (isCageEditCommand(command)) throw new Error("Component edit commands require their own batch");
    if (isCollectionCommand(command)) return this.applyCollectionCommand(objects, model, command);
    const existing = objects.get(command.objectId);
    // Deleting, renaming and re-parenting can free or change a name, which the index only adding names cannot follow.
    if (command.type === "scene.delete_object" || command.type === "scene.rename_object" || command.type === "scene.set_parent") claims.clear();
    if (command.type === "scene.delete_object") {
      if (!existing) throw new Error(`Object "${command.objectId}" does not exist`);
      for (const child of existing.children) {
        const id = [...objects].find(([, object]) => object === child)?.[0];
        if (id) throw new Error(`Delete the children of "${command.objectId}" before deleting it`);
      }
      existing.removeFromParent();
      objects.delete(command.objectId);
      model.forget(command.objectId);
      return undefined;
    }
    if (command.type === "scene.rename_object") {
      if (!existing) throw new Error(`Object "${command.objectId}" does not exist`);
      existing.name = this.uniqueName(objects, existing.parent, command.name, existing);
      return existing.name;
    }
    if (command.type === "scene.transform_object" || command.type === "scene.move_object" || command.type === "scene.set_visibility") {
      if (!existing) throw new Error(`Object "${command.objectId}" does not exist`);
      this.change(existing, command);
      return undefined;
    }
    if (command.type === "scene.set_parent") {
      if (!existing) throw new Error(`Object "${command.objectId}" does not exist`);
      const parent = command.parentId === null ? undefined : objects.get(command.parentId);
      if (command.parentId !== null && !parent) throw new Error(`Parent "${command.parentId}" does not exist`);
      this.reparent(existing, parent);
      // Under its new parent the object may share a name with a sibling; siblings keep distinct names.
      if (existing.name.length > 0) existing.name = this.uniqueName(objects, existing.parent, existing.name, existing);
      return existing.name;
    }
    if (
      existing &&
      !(command.type === "geometry.create_primitive" && command.replaceExisting)
    )
      throw new Error(
        `Object "${command.objectId}" already exists; use another objectId or set replaceExisting`,
      );
    // Whatever a new object is created under has to be there, so a missing parent fails before anything is built.
    const parent = command.parentId === undefined ? undefined : objects.get(command.parentId);
    if (command.parentId !== undefined && !parent) throw new Error(`Parent "${command.parentId}" does not exist`);
    if (command.collectionId !== undefined && !model.has(command.collectionId)) {
      throw new Error(`Collection "${command.collectionId}" does not exist; create it earlier in the batch or use an id from editor.get_context`);
    }
    let object: Object3D;
    let base: string;
    if (command.type === "geometry.create_primitive" || command.type === "geometry.create_mesh") {
      const geometry = command.type === "geometry.create_primitive" ? createPrimitive(command) : createPolygonMesh(command.vertices, command.faces, command.shading);
      object = new Mesh(
        geometry,
        new MeshStandardMaterial({ color: "#b6aaa4", roughness: 0.65, side: command.type === "geometry.create_mesh" || command.primitive === "plane" ? DoubleSide : FrontSide }),
      );
      base = command.type === "geometry.create_mesh" ? command.name ?? "Mesh" : command.name ?? command.primitive;
    } else {
      object = new Group();
      base = command.name;
    }
    if (command.transform) this.transform(object, command.transform);
    if (!existing) {
      let claim = claims.get(parent ?? null);
      if (!claim) {
        claim = new SiblingNames(this.siblingNames(objects, parent ?? null));
        claims.set(parent ?? null, claim);
      }
      const resolved = claim.claim(base);
      if (!resolved.ok) throw new Error(resolved.message);
      object.name = resolved.name;
    }
    if (existing) {
      // Replacing a shape keeps the object's name, place and position in the hierarchy.
      object.name = existing.name;
      object.visible = existing.visible;
      const own = storedOwnVisible(existing);
      if (typeof own === "boolean") object.userData[OWN_VISIBLE] = own;
      object.position.copy(existing.position);
      object.quaternion.copy(existing.quaternion);
      object.scale.copy(existing.scale);
      for (const child of [...existing.children]) object.add(child);
      existing.parent?.add(object);
      existing.removeFromParent();
    }
    objects.set(command.objectId, object);
    parent?.add(object);
    // A new object joins the collection it was given, else the one its parent is in, else the scene itself.
    if (!existing) {
      const joined = command.collectionId ?? (command.parentId === undefined ? null : model.collectionOf(command.parentId));
      const refused = model.assign(command.objectId, joined);
      if (refused) throw new Error(refused);
    }
    return object.name;
  }

  /** Applies one collection command to `model`, which is the staged copy. Returns the name a collection ended up with. */
  private applyCollectionCommand(objects: ReadonlyMap<string, Object3D>, model: CollectionModel, command: CollectionCommand): string | undefined {
    const check = (result: { ok: true; name: string } | { ok: false; message: string }): string => {
      if (!result.ok) throw new Error(result.message);
      return result.name;
    };
    const refuse = (message: string | undefined) => {
      if (message) throw new Error(message);
    };
    let name: string | undefined;
    switch (command.type) {
      case "scene.create_collection":
        name = check(model.create(command.collectionId, command.name, command.parentCollectionId ?? null));
        break;
      case "scene.rename_collection":
        name = check(model.rename(command.collectionId, command.name));
        break;
      case "scene.move_collection":
        name = check(model.move(command.collectionId, command.parentCollectionId));
        break;
      case "scene.set_collection_visibility":
        refuse(model.setVisible(command.collectionId, command.visible));
        break;
      case "scene.delete_collection":
        refuse(model.remove(command.collectionId));
        break;
      case "scene.move_to_collection": {
        if (!objects.has(command.objectId)) throw new Error(`Object "${command.objectId}" does not exist`);
        if (command.collectionId !== null && !model.has(command.collectionId)) {
          throw new Error(`Collection "${command.collectionId}" does not exist; create it first or use an id from editor.get_context`);
        }
        for (const id of command.includeChildren ? this.subtree(objects, command.objectId) : [command.objectId]) {
          refuse(model.assign(id, command.collectionId));
        }
        break;
      }
    }
    return name;
  }

  /** An object and every scene object that hangs below it, through any number of parents. */
  private subtree(objects: ReadonlyMap<string, Object3D>, rootId: string): string[] {
    const idOf = new Map<Object3D, string>();
    for (const [id, object] of objects) idOf.set(object, id);
    const found: string[] = [];
    const pending = [rootId];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      found.push(id);
      // Only scene objects are followed: the parts inside an imported model are not objects of the scene.
      for (const child of objects.get(id)?.children ?? []) {
        const childId = idOf.get(child);
        if (childId !== undefined) pending.push(childId);
      }
    }
    return found;
  }

  /** A batch of only collection commands, applied to a copy of the collections and committed whole or not at all. */
  private applyCollectionBatch(proposalId: string, commands: readonly CollectionCommand[], results: AppliedResult[]) {
    const model = this.collectionModel.clone();
    let current: CollectionCommand | undefined;
    try {
      commands.forEach((command, index) => {
        current = command;
        const name = this.applyCollectionCommand(this.objects, model, command);
        const result = results[index];
        if (name !== undefined && result) result.name = name;
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Command failed";
      return {
        status: "failed",
        revision: this.revision,
        results: commands.map((command) => ({
          commandId: command.commandId,
          status: "failed" as const,
          message: command === current ? reason : "Not applied: the batch was rolled back",
        })),
        message: `The batch was rolled back: command ${current?.commandId ?? "?"} failed. ${reason}`,
      };
    }
    const hadCollections = this.collectionModel.size > 0;
    this.collectionModel = model;
    this.refreshVisibility(hadCollections);
    this.revision += 1;
    this.applied.add(proposalId);
    this.notify();
    return { status: "applied", revision: this.revision, results };
  }

  /**
   * Sets what three.js draws from each object's own flag and its collections. After deleting the last collection,
   * restore the objects it hid before taking the fast path for scenes without collections.
   */
  private refreshVisibility(hadCollections = false): void {
    if (this.collectionModel.size === 0 && !hadCollections) return;
    const shown = new Map<string | null, boolean>();
    for (const [id, object] of this.objects) {
      const collection = this.collectionModel.collectionOf(id);
      let inShownCollections = shown.get(collection);
      if (inShownCollections === undefined) {
        inShownCollections = this.collectionModel.effectiveVisible(collection);
        shown.set(collection, inShownCollections);
      }
      if (inShownCollections) {
        object.visible = ownVisible(object);
      } else {
        if (typeof object.userData[OWN_VISIBLE] !== "boolean") object.userData[OWN_VISIBLE] = object.visible;
        object.visible = false;
      }
    }
  }

  /**
   * The names of the objects that share a parent, which is the top level when `parent` is null or the scene.
   * `except` is the object being named, `gone` the objects already deleted by the batch and `renamed` the names
   * the batch has already chosen, so a name is judged against the scene as the batch leaves it.
   */
  private siblingNames(
    objects: ReadonlyMap<string, Object3D>,
    parent: Object3D | null,
    except?: Object3D,
    gone?: ReadonlySet<Object3D>,
    renamed?: ReadonlyMap<Object3D, string>,
  ): Set<string> {
    const names = new Set<string>();
    const top = parent === null || parent === this.scene;
    for (const object of objects.values()) {
      if (object === except || gone?.has(object)) continue;
      const above = object.parent;
      if (top ? above !== null && above !== this.scene : above !== parent) continue;
      names.add(renamed?.get(object) ?? object.name);
    }
    return names;
  }

  /** `base` made unique among the objects under `parent`, or an error saying why it cannot be. */
  private uniqueName(objects: ReadonlyMap<string, Object3D>, parent: Object3D | null, base: string, except?: Object3D): string {
    const resolved = resolveSiblingName(base, this.siblingNames(objects, parent, except));
    if (!resolved.ok) throw new Error(resolved.message);
    return resolved.name;
  }
  /** Applies a command that changes one existing object's own properties. */
  private change(object: Object3D, command: ObjectChange, name?: string) {
    switch (command.type) {
      case "scene.transform_object":
        this.transform(object, command.transform);
        break;
      case "scene.move_object":
        object.position.x += command.delta[0] ?? 0;
        object.position.y += command.delta[1] ?? 0;
        object.position.z += command.delta[2] ?? 0;
        break;
      case "scene.rename_object":
        object.name = name ?? command.name;
        break;
      case "scene.set_visibility":
        // The collections the object is in are applied once the batch is done (refreshVisibility).
        object.userData[OWN_VISIBLE] = command.visible;
        object.visible = command.visible;
        break;
    }
  }

  /**
   * Moves an object under another object, or to the top level, without moving it in the world: its own place
   * is changed to make up for the new parent's. An object cannot go under itself or under anything below it.
   */
  private reparent(object: Object3D, parent: Object3D | undefined) {
    if (isWithinBranch(parent, object, (node) => node.parent))
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
