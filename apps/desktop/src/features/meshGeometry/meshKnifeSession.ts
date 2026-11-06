import type { BufferGeometry } from "three";
import type { PolygonMesh } from "./meshTopology";
import { knifeChord, type KnifePoint } from "./meshKnifeChord";

export interface KnifeSegment { face: number; start: KnifePoint; end: KnifePoint }
interface KnifeStep { segment: KnifeSegment; mesh: PolygonMesh; selection: string[] }
/** Temporary topology for a stroke. A failed step never changes the active preview. */
export class KnifeSession {
  private readonly base: PolygonMesh;
  private readonly source: BufferGeometry;
  private readonly steps: KnifeStep[] = [];
  constructor(base: PolygonMesh, source: BufferGeometry) { this.base = base; this.source = source; }
  get mesh(): PolygonMesh { return this.steps[this.steps.length - 1]?.mesh ?? this.base; }
  get length(): number { return this.steps.length; }
  get segments(): KnifeSegment[] { return this.steps.map(({ segment }) => ({ face: segment.face, start: { ...segment.start }, end: { ...segment.end } })); }
  get selection(): string[] { return [...(this.steps[this.steps.length - 1]?.selection ?? [])]; }
  append(segment: KnifeSegment): void {
    if (this.steps.length >= 64 || (this.base.faces.length + this.steps.length + 1) * (this.steps.length + 1) > 160000) throw new Error("Knife stroke exceeds the interactive geometry budget");
    const result = knifeChord(this.mesh, segment.face, segment.start, segment.end, this.source);
    this.steps.push({ segment: { face: segment.face, start: { ...segment.start }, end: { ...segment.end } }, mesh: result.mesh, selection: result.selection });
  }
  undo(count = 1): void {
    if (!Number.isInteger(count) || count < 1) throw new Error("Undo count must be a positive integer");
    this.steps.splice(Math.max(0, this.steps.length - count));
  }
}
