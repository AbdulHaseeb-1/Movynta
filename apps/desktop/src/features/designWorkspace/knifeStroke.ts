import type { Vector2, Camera, Matrix4 } from "three";
import type { KnifeSession } from "@/features/meshGeometry/meshKnifeSession";
import type { PolygonMesh } from "@/features/meshGeometry/meshTopology";
import { projectedKnifeSegments, projectKnife } from "./knifeProjection";

/** Plan each crossing against the current cage; roll back the whole pointer stroke on failure. */
export function cutKnifeStroke(
  session: KnifeSession,
  matrix: Matrix4,
  camera: Camera,
  width: number,
  height: number,
  from: Vector2,
  to: Vector2,
  onlyFaces: readonly number[] | null,
  visible: (mesh: PolygonMesh, face: number, midpoint: Vector2) => boolean,
): number {
  const previous = session.length;
  const allowed = onlyFaces
    ? Array.from(
        { length: session.mesh.faces.length - session.length },
        (_, i) => onlyFaces.includes(i),
      )
    : null;
  if (allowed)
    for (const segment of session.segments)
      allowed.splice(
        segment.face,
        1,
        Boolean(allowed[segment.face]),
        Boolean(allowed[segment.face]),
      );
  try {
    for (let iteration = 0; iteration < 65; iteration++) {
      const mesh = session.mesh,
        projected = projectKnife(mesh, matrix, camera, width, height);
      const candidates = projectedKnifeSegments(mesh, projected, from, to);
      let changed = false;
      for (const candidate of candidates) {
        if (allowed && !allowed[candidate.segment.face]) continue;
        const samples = [
          0.001, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 0.999,
        ].map((t) => candidate.from.clone().lerp(candidate.to, t));
        const visibility = samples.map((sample) =>
          visible(mesh, candidate.segment.face, sample),
        );
        if (visibility.some(Boolean) && visibility.some((v) => !v))
          throw new Error(
            "Partially occluded Knife cut: change view or enable cut-through",
          );
        if (!visibility[0]) continue;
        try {
          session.append(candidate.segment);
        } catch (error) {
          if (
            error instanceof Error &&
            error.message.includes("existing boundary edge")
          )
            continue;
          throw error;
        }
        if (allowed) allowed.splice(candidate.segment.face, 1, true, true);
        changed = true;
        break;
      }
      if (!changed) return session.length - previous;
    }
    throw new Error("Knife stroke exceeds the interactive geometry budget");
  } catch (error) {
    if (session.length > previous) session.undo(session.length - previous);
    throw error;
  }
}
