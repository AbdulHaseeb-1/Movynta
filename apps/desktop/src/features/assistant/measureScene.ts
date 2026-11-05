import { Box3, InstancedMesh, Matrix4, Mesh, SkinnedMesh, Triangle, Vector3, type Object3D } from "three";
import { measurementResultSchema, resolveMeshPath, type MeasurementRequest, type MeasurementResult } from "@movynta/editor-protocol";
import { meshAtPath, modifierStack } from "@/features/meshGeometry";
import { edgeKey, readTopology, topology } from "@/features/meshGeometry/meshTopology";
import { boxGap, closestSurface } from "@/features/meshGeometry/surfaceDistance";

type Dimensions = Extract<MeasurementRequest, { kind: "dimensions" }>;
type Endpoint = Extract<MeasurementRequest, { kind: "distance" }>["from"];
type Edge = Extract<MeasurementRequest, { kind: "edge" }>;
type Lookup = (id: string) => Object3D | undefined;
type Data = Extract<MeasurementResult, { status: "ok" }>["data"];
function isMesh(node: Object3D): node is Mesh { return node instanceof Mesh; }

const boundsOf = (box: Box3) => ({ min: box.min.toArray(), max: box.max.toArray() });
function inverse(matrix: Matrix4): Matrix4 | null {
  const determinant = matrix.determinant();
  return determinant === 0 || !Number.isFinite(determinant) ? null : matrix.clone().invert();
}

function objectOf(lookup: Lookup, target: Dimensions["target"]): Object3D {
  const object = resolveMeshPath(lookup(target.objectId), target.meshPath ?? []);
  if (!object) throw new Error("Measurement target or mesh path does not exist");
  return object;
}

/** Visit evaluated, drawn triangle coordinates, including imported and registered descendants. */
function geometryOf(root: Object3D, descendants: boolean, space: Matrix4 | null, surface: boolean) {
  const box = new Box3(), triangles: Triangle[] = [];
  const transform = new Matrix4();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let visited = 0;
  const scan = (node: Object3D) => {
    if (!isMesh(node)) return;
    if (node instanceof InstancedMesh) throw new Error("Instanced mesh measurements are unsupported");
    const geometry = node.geometry;
    const positions = geometry.getAttribute("position");
    if (!positions) return;
    const index = geometry.getIndex();
    const start = geometry.drawRange.start;
    const end = Math.min(start + geometry.drawRange.count, index?.count ?? positions.count);
    if (space) transform.multiplyMatrices(space, node.matrixWorld);
    else transform.copy(node.matrixWorld);
    const vertex = (i: number, point: Vector3) => node.getVertexPosition(index ? index.getX(i) : i, point).applyMatrix4(transform);
    const count = Math.floor((end - start) / 3);
    visited += Math.max(0, count);
    if (visited > (surface ? 20_000 : 2_000_000)) throw new Error("Measurement exceeds its triangle limit. Choose a smaller mesh part.");
    for (let i = start; i + 2 < end; i += 3) {
      vertex(i, a); vertex(i + 1, b); vertex(i + 2, c);
      box.expandByPoint(a).expandByPoint(b).expandByPoint(c);
      if (surface) {
        const triangle = new Triangle(a.clone(), b.clone(), c.clone());
        if (triangle.getArea() > 0) triangles.push(triangle);
      }
    }
  };
  if (descendants) root.traverse(scan);
  else scan(root);
  if (box.isEmpty()) throw new Error("Measurement target has no triangle geometry");
  return { box, triangles };
}

function cageOf(reference: Exclude<Endpoint, number[]> | Edge, lookup: Lookup, revision: number) {
  if (reference.revision !== revision) throw new Error("Component IDs are stale. Inspect the mesh again at the current revision.");
  const mesh = meshAtPath(lookup(reference.objectId), reference.meshPath ?? []);
  if (mesh instanceof SkinnedMesh || mesh instanceof InstancedMesh || mesh.morphTargetInfluences?.some((value) => value !== 0)) {
    throw new Error("Component IDs on deformed or instanced meshes are unsupported. Use world points or measure dimensions.");
  }
  const geometry = reference.view === "base" ? (modifierStack(mesh)?.base ?? mesh.geometry) : mesh.geometry;
  return { cage: readTopology(geometry), matrix: mesh.matrixWorld };
}

function distance(from: Vector3, to: Vector3): Data {
  const delta = to.clone().sub(from);
  return { kind: "distance", from: from.toArray(), to: to.toArray(), delta: delta.toArray(), length: delta.length() };
}

function measure(request: MeasurementRequest, lookup: Lookup, revision: number): Data {
  const resolvePoint = (value: Endpoint) => {
    if (Array.isArray(value)) return new Vector3().fromArray(value);
    const { cage, matrix } = cageOf(value, lookup, revision);
    const point = cage.positions[value.vertex];
    if (!point) throw new Error("Vertex ID does not exist on this mesh view");
    return point.clone().applyMatrix4(matrix);
  };
  switch (request.kind) {
    case "dimensions": {
      const object = objectOf(lookup, request.target);
      const space = request.space ?? "world";
      const frame = space === "local" ? inverse(object.matrixWorld) : null;
      if (space === "local" && !frame) throw new Error("Local dimensions require invertible object axes");
      const { box } = geometryOf(object, request.target.descendants ?? true, frame, false);
      const parent = lookup(request.target.objectId)?.parent;
      return { kind: "dimensions", space, bounds: boundsOf(box), size: box.getSize(new Vector3()).toArray(),
        center: box.getCenter(new Vector3()).toArray(), parentWorldInverse: parent ? inverse(parent.matrixWorld)?.toArray() ?? null : new Matrix4().toArray() };
    }
    case "distance":
      return distance(resolvePoint(request.from), resolvePoint(request.to));
    case "angle": {
      const center = resolvePoint(request.at);
      const first = resolvePoint(request.from).sub(center), second = resolvePoint(request.to).sub(center);
      if (first.lengthSq() === 0 || second.lengthSq() === 0) throw new Error("Angle needs two nonzero legs");
      return { kind: "angle", degrees: first.angleTo(second) * 180 / Math.PI };
    }
    case "edge": {
      const { cage, matrix } = cageOf(request, lookup, revision);
      const [a, b] = request.edge.split("_").map(Number);
      if (a === undefined || b === undefined || !topology(cage).edges.has(edgeKey(a, b))) throw new Error("Edge ID does not exist on this mesh view");
      const from = cage.positions[a], to = cage.positions[b];
      if (!from || !to) throw new Error("Edge vertices do not exist");
      return distance(from.clone().applyMatrix4(matrix), to.clone().applyMatrix4(matrix));
    }
    case "clearance": {
      const method = request.method ?? "bounds";
      const first = geometryOf(objectOf(lookup, request.first), request.first.descendants ?? true, null, method === "surface");
      const second = geometryOf(objectOf(lookup, request.second), request.second.descendants ?? true, null, method === "surface");
      const gap = boxGap(first.box, second.box);
      const parent = lookup(request.second.objectId)?.parent;
      return { kind: "clearance", method, distance: method === "surface" ? closestSurface(first.triangles, second.triangles) : gap.length(),
        firstBounds: boundsOf(first.box), secondBounds: boundsOf(second.box), axisGap: gap.toArray(),
        secondParentWorldInverse: parent ? inverse(parent.matrixWorld)?.toArray() ?? null : new Matrix4().toArray() };
    }
    default: throw new Error("Unknown measurement kind");
  }
}

export function measureScene(request: MeasurementRequest, lookup: Lookup, revision: number): MeasurementResult {
  try {
    const result = measurementResultSchema.safeParse({ status: "ok", data: measure(request, lookup, revision) });
    return result.success ? result.data : { status: "unavailable", message: "Measurement exceeds the supported numeric range" };
  } catch (error) {
    return { status: "unavailable", message: error instanceof Error ? error.message.slice(0, 500) : "Measurement unavailable" };
  }
}
