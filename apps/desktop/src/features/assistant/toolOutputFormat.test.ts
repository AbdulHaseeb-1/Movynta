import { describe, expect, it } from "vitest";
import { copyText, describeShape, formatBytes, readToolText, textBytes } from "./toolOutputFormat";

describe("readToolText", () => {
  it("reads JSON as a value, so it can be shown as a tree", () => {
    expect(readToolText('{"status":"ok","views":[1,2]}')).toEqual({
      kind: "json",
      value: { status: "ok", views: [1, 2] },
    });
  });

  it("reads anything that is not JSON as text, such as a result cut short by the storage limit", () => {
    expect(readToolText('{"views":[1,2')).toEqual({ kind: "text", text: '{"views":[1,2' });
    expect(readToolText("")).toEqual({ kind: "text", text: "" });
  });
});

describe("copyText", () => {
  it("copies JSON indented, and text as it is", () => {
    expect(copyText(readToolText('{"a":[1]}'))).toBe('{\n  "a": [\n    1\n  ]\n}');
    expect(copyText(readToolText("plain words"))).toBe("plain words");
  });
});

describe("formatBytes", () => {
  it("uses the largest unit that keeps the number above one", () => {
    expect(formatBytes(840)).toBe("840 B");
    expect(formatBytes(2458)).toBe("2.4 KB");
    expect(formatBytes(1024 * 1024 * 1.1)).toBe("1.1 MB");
  });
});

describe("textBytes", () => {
  it("counts UTF-8 bytes, so a multi-byte character takes more than one", () => {
    expect(textBytes("abc")).toBe(3);
    expect(textBytes("é")).toBe(2);
  });
});

describe("describeShape", () => {
  it("says how many items, fields or lines a value holds", () => {
    expect(describeShape(readToolText("[1,2,3]"))).toBe("3 items");
    expect(describeShape(readToolText('{"a":1}'))).toBe("1 field");
    expect(describeShape(readToolText('{"a":1,"b":2}'))).toBe("2 fields");
    expect(describeShape(readToolText("first\nsecond\nthird"))).toBe("3 lines");
    expect(describeShape(readToolText("42"))).toBe("one value");
  });

  it("calls an empty text empty, rather than one line", () => {
    expect(describeShape(readToolText("   "))).toBe("empty");
  });
});
