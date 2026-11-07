import type { BufferGeometry } from "three";
import type { ExtrudeResult } from "./meshExtrude";
import { edgeKey, type PolygonMesh } from "./meshTopology";
import { knifeChord, type KnifePoint } from "./meshKnifeChord";
import { validateTopologyEdit } from "./meshTopologyEdit";

export interface KnifeSegment {
  face: number;
  start: KnifePoint;
  end: KnifePoint;
}
export interface KnifeSessionOptions {
  /**
   * Check the whole mesh once, in `finish()`, instead of after every cut. For a stroke that is applied as one
   * command: each cut still checks its own faces, and adds one face, so there is nothing to bound but the segment count.
   */
  deferValidation?: boolean;
}
interface KnifeStep {
  segment: KnifeSegment;
  mesh: PolygonMesh;
  selection: string[];
}
const MAX_SEGMENTS = 64;
/** Temporary topology for a stroke. A failed step never changes the active preview. */
export class KnifeSession {
  private readonly base: PolygonMesh;
  private readonly source: BufferGeometry;
  private readonly deferred: boolean;
  private readonly steps: KnifeStep[] = [];
  constructor(base: PolygonMesh, source: BufferGeometry, options: KnifeSessionOptions = {}) {
    this.base = base;
    this.source = source;
    this.deferred = options.deferValidation === true;
  }
  get mesh(): PolygonMesh {
    return this.steps[this.steps.length - 1]?.mesh ?? this.base;
  }
  get length(): number {
    return this.steps.length;
  }
  get segments(): KnifeSegment[] {
    return this.steps.map(({ segment }) => ({
      face: segment.face,
      start: { ...segment.start },
      end: { ...segment.end },
    }));
  }
  get selection(): string[] {
    return [...(this.steps[this.steps.length - 1]?.selection ?? [])];
  }
  append(segment: KnifeSegment): void {
    if (this.steps.length >= MAX_SEGMENTS) throw new Error("Knife stroke exceeds the interactive geometry budget");
    // An interactive stroke checks the whole mesh after every cut, so it is bounded by the work that costs.
    if (!this.deferred && (this.base.faces.length + this.steps.length + 1) * (this.steps.length + 1) > 160000)
      throw new Error("Knife stroke exceeds the interactive geometry budget");
    // The selection accumulates across cuts; a cut that splits an already selected edge keeps both halves selected.
    const selected = new Set(this.selection);
    let nextVertex = this.mesh.positions.length;
    for (const endpoint of [segment.start, segment.end])
      if ("edge" in endpoint) {
        if (selected.delete(endpoint.edge)) {
          const [a, b] = endpoint.edge.split("_").map(Number);
          if (a === undefined || b === undefined) throw new Error("Invalid cut edge");
          selected.add(edgeKey(a, nextVertex));
          selected.add(edgeKey(nextVertex, b));
        }
        nextVertex++;
      }
    const result = knifeChord(this.mesh, segment.face, segment.start, segment.end, this.source, {
      validate: !this.deferred,
    });
    for (const id of result.selection) selected.add(id);
    this.steps.push({
      segment: { face: segment.face, start: { ...segment.start }, end: { ...segment.end } },
      mesh: result.mesh,
      selection: [...selected],
    });
  }
  undo(count = 1): void {
    if (!Number.isInteger(count) || count < 1) throw new Error("Undo count must be a positive integer");
    this.steps.splice(Math.max(0, this.steps.length - count));
  }
  /** The finished stroke, checked as a whole when validation was deferred. */
  finish(): ExtrudeResult {
    if (this.deferred && this.steps.length > 0) validateTopologyEdit(this.base, this.mesh);
    return { mesh: this.mesh, selection: this.selection, walls: [] };
  }
}
