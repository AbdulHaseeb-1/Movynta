import { describe, expect, it, vi } from "vitest";
import { fileNameOf, saveFile, type NativeSave } from "./saveFile";

const options = { title: "Export for Blender", filters: [{ name: "glTF binary", extensions: ["glb"] }] };

function nativeThatChooses(path: string | null): NativeSave & { written: { path: string; bytes: Uint8Array }[] } {
  const written: { path: string; bytes: Uint8Array }[] = [];
  return {
    written,
    chooseLocation: vi.fn(() => Promise.resolve(path)),
    write: vi.fn((target: string, bytes: Uint8Array) => {
      written.push({ path: target, bytes });
      return Promise.resolve();
    }),
  };
}

describe("saveFile in the desktop app", () => {
  it("offers the file name and type, then writes the bytes where the user chose", async () => {
    const native = nativeThatChooses("C:\\Models\\robot.glb");
    const outcome = await saveFile(new Blob([new Uint8Array([1, 2, 3])]), "robot.glb", { ...options, native, desktop: true });
    expect(outcome).toEqual({ status: "saved", path: "C:\\Models\\robot.glb" });
    expect(native.chooseLocation).toHaveBeenCalledWith({ title: "Export for Blender", defaultPath: "robot.glb", filters: options.filters });
    expect(native.written).toHaveLength(1);
    expect(native.written[0]?.path).toBe("C:\\Models\\robot.glb");
    expect(Array.from(native.written[0]?.bytes ?? [])).toEqual([1, 2, 3]);
  });

  it("writes nothing when the user closes the dialog", async () => {
    const native = nativeThatChooses(null);
    const outcome = await saveFile(new Blob(["x"]), "robot.glb", { ...options, native, desktop: true });
    expect(outcome).toEqual({ status: "cancelled" });
    expect(native.write).not.toHaveBeenCalled();
  });

  it("reports a failed write instead of claiming the file was saved", async () => {
    const native: NativeSave = { chooseLocation: () => Promise.resolve("D:\\locked\\robot.glb"), write: () => Promise.reject(new Error("Access is denied")) };
    await expect(saveFile(new Blob(["x"]), "robot.glb", { ...options, native, desktop: true })).rejects.toThrow("Access is denied");
  });
});

describe("saveFile in a browser", () => {
  it("starts a download", async () => {
    const click = vi.fn();
    const link = { href: "", download: "", hidden: false, click, remove: vi.fn() };
    vi.stubGlobal("document", { createElement: () => link, body: { append: vi.fn() } });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:mock", revokeObjectURL: vi.fn() });
    vi.stubGlobal("window", { setTimeout: vi.fn() });
    try {
      const outcome = await saveFile(new Blob(["x"]), "robot.glb", { ...options, desktop: false });
      expect(outcome).toEqual({ status: "downloaded" });
      expect(link.download).toBe("robot.glb");
      expect(click).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("fileNameOf", () => {
  it("returns the last part of a path with either separator", () => {
    expect(fileNameOf("C:\\Models\\robot.glb")).toBe("robot.glb");
    expect(fileNameOf("/home/me/robot.glb")).toBe("robot.glb");
    expect(fileNameOf("robot.glb")).toBe("robot.glb");
  });
});
