import { BufferGeometry, Float32BufferAttribute, Group, Mesh, type Material } from "three";

const SPACE = 32;
const TAB = 9;
const CARRIAGE_RETURN = 13;
const SLASH = 47;
const MINUS = 45;
const PLUS = 43;
const ZERO = 48;
const NINE = 57;

/** One object of the file: its corners laid out flat, ready to become a geometry. */
interface Part {
  name: string;
  positions: number[];
  normals: number[];
  uvs: number[];
  /** True while every corner so far came with a normal (or a texture coordinate). */
  allNormals: boolean;
  allUvs: boolean;
}

function newPart(name: string): Part {
  return { name, positions: [], normals: [], uvs: [], allNormals: true, allUvs: true };
}

function isBlank(code: number): boolean {
  return code === SPACE || code === TAB;
}

/**
 * Reads a Wavefront OBJ file: geometry only (`v`, `vn`, `vt`, `f`, and `o` or `g` to split objects).
 * Materials and textures are not loaded, as the importer never could load them, so every object gets
 * `material`. Faces with more than three corners are fanned into triangles, and indices may be
 * negative (counted back from the latest vertex), as the format allows.
 *
 * This is a scanner, not a pattern matcher: it walks the text once, reading numbers and indices in
 * place. On large files that is several times faster than the general loader in three.js.
 */
export function parseObj(text: string, material: Material): Group {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const finished: Part[] = [];
  let part = newPart("");
  // The corners of the face being read: indices into the lists above, or -1 when the file left one out.
  const cornerPosition: number[] = [];
  const cornerUv: number[] = [];
  const cornerNormal: number[] = [];

  /** Reads one integer starting at `at`. Leaves the position after it in `cursor`. */
  let cursor = 0;
  const readInteger = (at: number, end: number): number => {
    let index = at;
    let negative = false;
    const first = text.charCodeAt(index);
    if (first === MINUS || first === PLUS) {
      negative = first === MINUS;
      index += 1;
    }
    let value = 0;
    let digits = 0;
    while (index < end) {
      const code = text.charCodeAt(index);
      if (code < ZERO || code > NINE) break;
      value = value * 10 + (code - ZERO);
      digits += 1;
      index += 1;
    }
    cursor = index;
    return digits === 0 ? Number.NaN : negative ? -value : value;
  };

  /** Turns a one-based (or negative, relative) index into a zero-based one, or -1 when it is out of range. */
  const resolve = (value: number, count: number): number => {
    if (!Number.isInteger(value) || value === 0) return -1;
    const index = value > 0 ? value - 1 : count + value;
    return index >= 0 && index < count ? index : -1;
  };

  const pushNumbers = (target: number[], start: number, end: number, count: number) => {
    let index = start;
    for (let found = 0; found < count; found += 1) {
      while (index < end && isBlank(text.charCodeAt(index))) index += 1;
      let stop = index;
      while (stop < end && !isBlank(text.charCodeAt(stop))) stop += 1;
      const value = stop > index ? Number(text.substring(index, stop)) : 0;
      target.push(Number.isFinite(value) ? value : 0);
      index = stop;
    }
  };

  const addFace = (start: number, end: number) => {
    cornerPosition.length = 0;
    cornerUv.length = 0;
    cornerNormal.length = 0;
    let index = start;
    while (index < end) {
      while (index < end && isBlank(text.charCodeAt(index))) index += 1;
      if (index >= end) break;
      const vertex = resolve(readInteger(index, end), positions.length / 3);
      index = cursor;
      let uv = -1;
      let normal = -1;
      if (text.charCodeAt(index) === SLASH) {
        index += 1;
        if (text.charCodeAt(index) !== SLASH) {
          uv = resolve(readInteger(index, end), uvs.length / 2);
          index = cursor;
        }
        if (text.charCodeAt(index) === SLASH) {
          index += 1;
          normal = resolve(readInteger(index, end), normals.length / 3);
          index = cursor;
        }
      }
      // Anything unexpected after the indices is skipped up to the next blank.
      while (index < end && !isBlank(text.charCodeAt(index))) index += 1;
      if (vertex < 0) return;
      cornerPosition.push(vertex);
      cornerUv.push(uv);
      cornerNormal.push(normal);
    }
    const corners = cornerPosition.length;
    for (let corner = 1; corner + 1 < corners; corner += 1) {
      for (const at of [0, corner, corner + 1]) {
        const vertex = (cornerPosition[at] ?? 0) * 3;
        part.positions.push(positions[vertex] ?? 0, positions[vertex + 1] ?? 0, positions[vertex + 2] ?? 0);
        const normal = (cornerNormal[at] ?? -1) * 3;
        if (normal >= 0) part.normals.push(normals[normal] ?? 0, normals[normal + 1] ?? 0, normals[normal + 2] ?? 0);
        else part.allNormals = false;
        const uv = (cornerUv[at] ?? -1) * 2;
        if (uv >= 0) part.uvs.push(uvs[uv] ?? 0, uvs[uv + 1] ?? 0);
        else part.allUvs = false;
      }
    }
  };

  const length = text.length;
  for (let line = 0; line < length; ) {
    let newline = text.indexOf("\n", line);
    if (newline === -1) newline = length;
    let end = newline;
    if (end > line && text.charCodeAt(end - 1) === CARRIAGE_RETURN) end -= 1;
    let start = line;
    while (start < end && isBlank(text.charCodeAt(start))) start += 1;
    line = newline + 1;
    if (start >= end) continue;

    const first = text.charCodeAt(start);
    const second = start + 1 < end ? text.charCodeAt(start + 1) : 0;
    if (first === 118 /* v */) {
      if (isBlank(second)) pushNumbers(positions, start + 1, end, 3);
      else if (second === 110 /* n */) pushNumbers(normals, start + 2, end, 3);
      else if (second === 116 /* t */) pushNumbers(uvs, start + 2, end, 2);
    } else if (first === 102 /* f */ && isBlank(second)) {
      addFace(start + 1, end);
    } else if ((first === 111 /* o */ || first === 103 /* g */) && isBlank(second)) {
      if (part.positions.length > 0) finished.push(part);
      part = newPart(text.substring(start + 1, end).trim());
    }
  }
  if (part.positions.length > 0) finished.push(part);

  const group = new Group();
  for (const item of finished) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(item.positions, 3));
    if (item.allNormals) geometry.setAttribute("normal", new Float32BufferAttribute(item.normals, 3));
    else geometry.computeVertexNormals();
    if (item.allUvs) geometry.setAttribute("uv", new Float32BufferAttribute(item.uvs, 2));
    const mesh = new Mesh(geometry, material);
    mesh.name = item.name;
    group.add(mesh);
  }
  return group;
}
