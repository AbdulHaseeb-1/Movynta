import { beforeEach, describe, expect, it } from "vitest";
import type { CapturedImage } from "@movynta/editor-protocol";
import { forgetCaptures, MAX_REMEMBERED_CAPTURES, recallCapture, rememberCapture } from "./capturedPictures";

function image(label: string, data = "AAAA", camera: Partial<CapturedImage["camera"]> = {}): CapturedImage {
  return {
    label,
    mediaType: "image/jpeg",
    data,
    width: 768,
    height: 576,
    camera: { projection: "perspective", position: [0, 0, 5], target: [0, 0, 0], fov: 40, orthographicHeight: null, ...camera },
    objects: [],
  };
}

describe("the pictures the chat shows", () => {
  beforeEach(forgetCaptures);

  it("keeps what the assistant was given, ready to show, under the id of the capture", () => {
    rememberCapture("cap_1", [image("front", "AAAA"), image("top", "BBBB")]);

    const shown = recallCapture("cap_1");
    expect(shown?.map((item) => item.label)).toEqual(["front", "top"]);
    expect(shown?.[0]?.src).toBe("data:image/jpeg;base64,AAAA");
    expect(shown?.[0]).toMatchObject({ width: 768, height: 576 });
  });

  it("tells pictures apart even when two views share a label", () => {
    rememberCapture("cap_1", [image("front"), image("front")]);

    const ids = recallCapture("cap_1")?.map((item) => item.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("says how each picture was taken", () => {
    rememberCapture("cap_1", [
      image("front", "AAAA", { projection: "orthographic", fov: null, orthographicHeight: 4 }),
      image("iso", "BBBB", { fov: 39.6 }),
      image("odd", "CCCC", { fov: null }),
    ]);

    expect(recallCapture("cap_1")?.map((item) => item.camera)).toEqual([
      "Orthographic view",
      "Perspective view, 40 degree field of view",
      "Perspective view",
    ]);
  });

  it("keeps nothing for a capture that drew no pictures", () => {
    rememberCapture("cap_1", [image("front", "")]);
    rememberCapture("cap_2", []);

    expect(recallCapture("cap_1")).toBeUndefined();
    expect(recallCapture("cap_2")).toBeUndefined();
    expect(recallCapture("never_taken")).toBeUndefined();
  });

  it("drops only the pictures that were not drawn", () => {
    rememberCapture("cap_1", [image("front", ""), image("top", "BBBB")]);

    expect(recallCapture("cap_1")?.map((item) => item.label)).toEqual(["top"]);
  });

  it("forgets the oldest captures once too many are kept", () => {
    for (let index = 0; index < MAX_REMEMBERED_CAPTURES + 3; index += 1) rememberCapture(`cap_${index}`, [image("front")]);

    expect(recallCapture("cap_0")).toBeUndefined();
    expect(recallCapture("cap_2")).toBeUndefined();
    expect(recallCapture("cap_3")).toBeDefined();
    expect(recallCapture(`cap_${MAX_REMEMBERED_CAPTURES + 2}`)).toBeDefined();
  });

  it("replaces a capture filed again under the same id, and counts it as the newest", () => {
    rememberCapture("cap_a", [image("front", "AAAA")]);
    for (let index = 0; index < MAX_REMEMBERED_CAPTURES - 1; index += 1) rememberCapture(`cap_${index}`, [image("front")]);
    rememberCapture("cap_a", [image("front", "ZZZZ")]);
    rememberCapture("cap_extra", [image("front")]);

    expect(recallCapture("cap_a")?.[0]?.src).toBe("data:image/jpeg;base64,ZZZZ");
    expect(recallCapture("cap_0")).toBeUndefined();
  });
});
