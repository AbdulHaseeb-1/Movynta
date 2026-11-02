import type { EditorScene } from "@/features/assistant";
import { boneAt, rigOf } from "./rig";

/** A bone of a model in the scene. */
export interface BoneRef {
  objectId: string;
  bone: number;
}

/**
 * The bone being posed. It belongs to the selected object, so it follows that selection: choosing
 * another object, deleting the model or replacing it with a model that has fewer bones clears it.
 */
export class BoneSelection {
  private current: BoneRef | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly editor: EditorScene;
  private readonly stopWatching: () => void;

  constructor(editor: EditorScene) {
    this.editor = editor;
    this.stopWatching = editor.onChange(() => {
      if (this.current && !this.stillValid(this.current)) this.select(undefined);
    });
  }

  get selected(): BoneRef | undefined {
    return this.current;
  }

  select(next: BoneRef | undefined): void {
    if (next?.objectId === this.current?.objectId && next?.bone === this.current?.bone) return;
    this.current = next;
    for (const listener of this.listeners) listener();
  }

  /** Calls `listener` whenever the selected bone changes. Returns a function that stops it. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.stopWatching();
    this.listeners.clear();
  }

  private stillValid({ objectId, bone }: BoneRef): boolean {
    if (this.editor.selection !== objectId) return false;
    const object = this.editor.getObject(objectId);
    const rig = object ? rigOf(object) : undefined;
    return rig !== undefined && boneAt(rig, bone) !== undefined;
  }
}
