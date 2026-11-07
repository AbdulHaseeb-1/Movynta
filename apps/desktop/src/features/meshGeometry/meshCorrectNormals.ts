import { Vector3 } from "three";
import { channels, point, topology, type PolygonMesh } from "./meshTopology";
import { triangulate } from "./meshOutput";
import { validateTopologyEdit } from "./meshTopologyEdit";

/** How normals are corrected: consistent, or outward. */
export type NormalCorrectionMode = "consistent" | "outward";
/** Make each connected face shell consistently wound. Optionally orient each closed shell outward. */
export function correctNormals(mesh: PolygonMesh, mode: NormalCorrectionMode) {
  const graph = topology(mesh),
    adjacent = mesh.faces.map((): { face: number; toggle: boolean }[] => []);
  for (const incident of graph.edges.values()) {
    if (incident.length > 2) throw new Error("Cannot correct normals on non-manifold edges");
    const [a, b] = incident;
    if (!a || !b) continue;
    const toggle = a.from === b.from;
    adjacent[a.face]?.push({ face: b.face, toggle });
    adjacent[b.face]?.push({ face: a.face, toggle });
  }
  const flip: (boolean | undefined)[] = mesh.faces.map(() => undefined);
  const components: number[][] = [];
  for (let seed = 0; seed < mesh.faces.length; seed++) {
    if (flip[seed] !== undefined) continue;
    flip[seed] = false;
    const pending = [seed],
      component: number[] = [];
    while (pending.length) {
      const face = pending.pop();
      if (face === undefined) continue;
      component.push(face);
      for (const next of adjacent[face] ?? []) {
        const desired = Boolean(flip[face]) !== next.toggle;
        if (flip[next.face] === undefined) {
          flip[next.face] = desired;
          pending.push(next.face);
        } else if (flip[next.face] !== desired)
          throw new Error("Mesh cannot be oriented consistently; inspect non-orientable or overlapping faces");
      }
    }
    components.push(component);
  }
  const open = new Set<number>();
  const faceComponent = new Map<number, number>();
  components.forEach((component, index) => component.forEach((face) => faceComponent.set(face, index)));
  for (const incident of graph.edges.values())
    if (incident.length === 1) {
      const face = incident[0]?.face;
      if (face !== undefined) {
        const index = faceComponent.get(face);
        if (index !== undefined) open.add(index);
      }
    }
  if (mode === "outward")
    for (let index = 0; index < components.length; index++) {
      const component = components[index];
      if (!component || open.has(index)) continue;
      const firstFace = mesh.faces[component[0] ?? -1];
      const origin = point(mesh, firstFace?.[0]);
      let volume = 0,
        extent = 0;
      for (const faceId of component) {
        const face = mesh.faces[faceId];
        if (!face) throw new Error("Invalid face");
        for (const vertex of face) extent = Math.max(extent, point(mesh, vertex).distanceTo(origin));
        for (const triangle of triangulate(mesh, face)) {
          const a = point(mesh, face[triangle[0] ?? -1])
            .clone()
            .sub(origin);
          const b = point(mesh, face[triangle[1] ?? -1])
            .clone()
            .sub(origin);
          const c = point(mesh, face[triangle[2] ?? -1])
            .clone()
            .sub(origin);
          volume += a.dot(new Vector3().crossVectors(b, c)) * (flip[faceId] ? -1 : 1);
        }
      }
      if (Math.abs(volume) <= extent ** 3 * 1e-12)
        throw new Error("Closed shell has ambiguous volume; outward direction cannot be determined");
      if (volume < 0) for (const face of component) flip[face] = !flip[face];
    }
  const data = channels(mesh);
  const result: PolygonMesh = {
    ...mesh,
    faces: mesh.faces.map((face, i) => (flip[i] ? [...face].reverse() : [...face])),
    channels: { ...data, corners: data.corners.map((corner, i) => (flip[i] ? [...corner].reverse() : [...corner])) },
  };
  validateTopologyEdit(result, result);
  return {
    mesh: result,
    walls: [] as number[],
    selection: [] as string[],
    flipped: flip.filter(Boolean).length,
    shells: components.length,
    openShells: open.size,
  };
}
