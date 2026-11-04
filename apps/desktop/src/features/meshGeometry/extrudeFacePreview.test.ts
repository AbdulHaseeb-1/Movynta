import { expect, it } from "vitest";
import { BoxGeometry, Vector3 } from "three";
import {
  extrudeRegion,
  writeExtrudedGeometry,
  ZeroAreaWallError,
} from "./meshExtrude";
import { readTopology } from "./meshTopology";
import { ExtrudeFacePreview } from "./extrudeFacePreview";

it("matches a freshly built extrusion after moving the cap and preserves the last valid preview on a blocked move", () => {
  const source = new BoxGeometry(2, 2, 2);
  const cage = readTopology(source);
  const initial = new Vector3(0.2, 0.4, 0.5);
  const next = new Vector3(0.4, 0.8, 0.3);
  const preview = new ExtrudeFacePreview(
    source,
    extrudeRegion(cage, "face", ["0"], initial),
    initial,
  );
  preview.update(next);
  const expected = writeExtrudedGeometry(
    source,
    extrudeRegion(cage, "face", ["0"], next),
  );
  for (const name of ["position", "normal", "uv"]) {
    const actual = preview.geometry.getAttribute(name);
    const reference = expected.getAttribute(name);
    expect(actual.count).toBe(reference.count);
    for (let i = 0; i < actual.count; i++)
      for (let c = 0; c < actual.itemSize; c++)
        expect(actual.getComponent(i, c)).toBeCloseTo(
          reference.getComponent(i, c),
          5,
        );
  }
  const before = Array.from(preview.geometry.getAttribute("position").array);
  expect(() => preview.update(new Vector3(0, 1, 0))).toThrow(ZeroAreaWallError);
  expect(Array.from(preview.geometry.getAttribute("position").array)).toEqual(
    before,
  );
  preview.geometry.dispose();
  expected.dispose();
  source.dispose();
});
