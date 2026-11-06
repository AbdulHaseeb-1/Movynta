import type { BufferGeometry } from "three";
import { channels, continuityChannels, faceNormal, point, type PolygonMesh } from "./meshTopology";
import { evaluate } from "./meshWeights";
import { triangulate } from "./meshOutput";

/** Reject retriangulation that could change the surface or non-affine corner data. */
export function validateKnifeFace(mesh: PolygonMesh, faceId: number, source: BufferGeometry): void {
  const face = mesh.faces[faceId]; if (!face || face.length < 3) throw new Error("Invalid knife face");
  const data = channels(mesh), corners = data.corners[faceId];
  if (!corners || corners.length !== face.length) throw new Error("Missing knife corner attributes");
  const normal = faceNormal(mesh, face), origin = point(mesh, face[0]);
  const size = Math.max(...face.map((id) => point(mesh, id).distanceTo(origin)), 1e-10);
  if (normal.lengthSq() === 0 || face.some((id) => Math.abs(point(mesh, id).clone().sub(origin).dot(normal)) > size * 1e-7)) throw new Error("Knife requires planar affected faces");
  if (face.length === 3) return;
  const triangle = triangulate(mesh, face)[0];
  const ai = triangle?.[0], bi = triangle?.[1], ci = triangle?.[2];
  if (ai === undefined || bi === undefined || ci === undefined) throw new Error("Knife face has no stable triangulation");
  const a = point(mesh, face[ai]), u = point(mesh, face[bi]).clone().sub(a), v = point(mesh, face[ci]).clone().sub(a);
  const wa = corners[ai], wb = corners[bi], wc = corners[ci]; if (!wa || !wb || !wc) throw new Error("Missing knife corner attributes");
  const uu = u.dot(u), uv = u.dot(v), vv = v.dot(v), det = uu * vv - uv * uv;
  if (!(det > 0)) throw new Error("Knife face is degenerate");
  const attributes = [...continuityChannels(source), ...(source.morphAttributes.position ?? []), source.getAttribute("skinIndex"), source.getAttribute("skinWeight")].filter((attribute) => attribute !== undefined);
  face.forEach((vertex, corner) => {
    const sample = corners[corner]; if (!sample) throw new Error("Missing knife corner attributes");
    const delta = point(mesh, vertex).clone().sub(a), du = delta.dot(u), dv = delta.dot(v);
    const beta = (du * vv - dv * uv) / det, gamma = (dv * uu - du * uv) / det;
    for (const attribute of attributes) for (let c = 0; c < attribute.itemSize; c++) {
      const expected = (1-beta-gamma)*evaluate(attribute, wa, c) + beta*evaluate(attribute, wb, c) + gamma*evaluate(attribute, wc, c);
      const actual = evaluate(attribute, sample, c);
      if (!Number.isFinite(expected) || !Number.isFinite(actual) || Math.abs(expected - actual) > Math.max(1, Math.abs(expected), Math.abs(actual))*1e-6) throw new Error("Knife would change non-affine UV, color or deformation detail");
    }
  });
}
