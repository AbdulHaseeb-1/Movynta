import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_EDGE } from "@movynta/contracts";
import { describe, expect, it, vi } from "vitest";
import { dragHasFiles, pictureFiles, picturesFromClipboard } from "./imageFiles";
import { attachmentName, canSendUnchanged, fitsTotal, fitWithin, mediaTypeOf, toBase64, uniqueName, withExtension } from "./imagePlan";
import { prepareImage, type ImageCodec, MAX_SOURCE_BYTES } from "./prepareImage";
import { AttachmentError } from "./types";
import { savedExchangesToMessages } from "../assistant/conversationMessages";

function file(name: string, type: string, bytes = 100): File {
  return new File([new Uint8Array(bytes).fill(7)], name, { type });
}

/** A codec that reports a fixed size and saves JPEGs whose size depends on the pixels and the quality. */
function fakeCodec(size: { width: number; height: number }, jpegBytes: (width: number, quality: number) => number = () => 1000): ImageCodec & { encodes: { width: number; height: number; quality: number }[]; closed: () => number } {
  const encodes: { width: number; height: number; quality: number }[] = [];
  let closed = 0;
  return {
    encodes,
    closed: () => closed,
    open: () =>
      Promise.resolve({
        size,
        encodeJpeg: (target, quality) => {
          encodes.push({ ...target, quality });
          return Promise.resolve(new Blob([new Uint8Array(jpegBytes(target.width, quality))]));
        },
        close: () => {
          closed += 1;
        },
      }),
  };
}

describe("mediaTypeOf", () => {
  it("accepts the formats models read", () => {
    expect(mediaTypeOf(file("a.png", "image/png"))).toBe("image/png");
    expect(mediaTypeOf(file("a.jpg", "image/jpeg"))).toBe("image/jpeg");
    expect(mediaTypeOf(file("a.jpg", "image/jpg"))).toBe("image/jpeg");
    expect(mediaTypeOf(file("a.webp", "image/webp"))).toBe("image/webp");
    expect(mediaTypeOf(file("a.gif", "image/gif"))).toBe("image/gif");
  });

  it("refuses formats they cannot read, whatever the extension says", () => {
    expect(mediaTypeOf(file("logo.svg", "image/svg+xml"))).toBeUndefined();
    expect(mediaTypeOf(file("scan.tiff", "image/tiff"))).toBeUndefined();
    expect(mediaTypeOf(file("notes.png", "text/plain"))).toBeUndefined();
  });

  it("falls back to the extension only when the system gave no type", () => {
    expect(mediaTypeOf(file("dropped.PNG", ""))).toBe("image/png");
    expect(mediaTypeOf(file("dropped.jpeg", ""))).toBe("image/jpeg");
    expect(mediaTypeOf(file("dropped.bin", ""))).toBeUndefined();
  });
});

describe("fitWithin", () => {
  it("leaves a picture that fits alone", () => {
    expect(fitWithin({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
    expect(fitWithin({ width: MAX_ATTACHMENT_EDGE, height: 10 })).toEqual({ width: MAX_ATTACHMENT_EDGE, height: 10 });
  });

  it("scales the longer side down to the limit and keeps the proportions", () => {
    expect(fitWithin({ width: 3136, height: 1568 })).toEqual({ width: MAX_ATTACHMENT_EDGE, height: 784 });
    expect(fitWithin({ width: 1000, height: 4000 })).toEqual({ width: 392, height: MAX_ATTACHMENT_EDGE });
  });

  it("never returns an empty side", () => {
    expect(fitWithin({ width: 100000, height: 1 })).toEqual({ width: MAX_ATTACHMENT_EDGE, height: 1 });
  });
});

describe("canSendUnchanged", () => {
  const small = { width: 640, height: 480 };
  it("sends a small picture as it is", () => {
    expect(canSendUnchanged({ size: 50_000 }, "image/png", small)).toBe(true);
  });
  it("re-encodes a picture that is too heavy or too large", () => {
    expect(canSendUnchanged({ size: MAX_ATTACHMENT_BYTES + 1 }, "image/jpeg", small)).toBe(false);
    expect(canSendUnchanged({ size: 50_000 }, "image/jpeg", { width: 4000, height: 3000 })).toBe(false);
  });
  it("re-encodes a GIF so that models see a still picture", () => {
    expect(canSendUnchanged({ size: 50_000 }, "image/gif", small)).toBe(false);
  });
});

describe("names", () => {
  it("keeps the name of a file and names pasted pictures", () => {
    expect(attachmentName({ name: "robot front.png" }, "image/png")).toBe("robot front.png");
    expect(attachmentName({ name: "image.png" }, "image/png", 2)).toBe("pasted-image-2.png");
    expect(attachmentName({ name: "" }, "image/jpeg")).toBe("pasted-image-1.jpg");
  });
  it("changes the extension when the format changes", () => {
    expect(withExtension("photo.png", "image/jpeg")).toBe("photo.jpg");
    expect(withExtension("animated.gif", "image/jpeg")).toBe("animated.jpg");
    expect(withExtension("noextension", "image/jpeg")).toBe("noextension.jpg");
  });
});

describe("uniqueName", () => {
  it("keeps a name nobody has taken", () => {
    expect(uniqueName("shot.png", [])).toBe("shot.png");
    expect(uniqueName("shot.png", ["other.png"])).toBe("shot.png");
  });
  it("numbers a repeat before its extension, so two pictures never share a name", () => {
    expect(uniqueName("pasted-image-4.png", ["pasted-image-4.png"])).toBe("pasted-image-4 (2).png");
    expect(uniqueName("shot.png", ["shot.png", "shot (2).png"])).toBe("shot (3).png");
    expect(uniqueName("noextension", ["noextension"])).toBe("noextension (2)");
  });
  it("compares names as the file system does, without regard to case", () => {
    expect(uniqueName("Shot.PNG", ["shot.png"])).toBe("Shot (2).PNG");
  });
});

describe("toBase64", () => {
  it("matches a byte-by-byte encoding, including for data larger than one chunk", () => {
    const bytes = Uint8Array.from({ length: 100_003 }, (_, index) => index % 251);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    expect(toBase64(bytes)).toBe(btoa(binary));
    expect(toBase64(new Uint8Array())).toBe("");
  });
});

describe("prepareImage", () => {
  it("sends a small picture byte for byte", async () => {
    const codec = fakeCodec({ width: 640, height: 480 });
    const source = file("ref.png", "image/png", 2048);
    const image = await prepareImage(source, 1, codec);
    expect(image).toMatchObject({ name: "ref.png", mediaType: "image/png", bytes: 2048, width: 640, height: 480 });
    expect(image.data).toBe(btoa("\u0007".repeat(2048)));
    expect(image.src).toBe(`data:image/png;base64,${image.data}`);
    expect(codec.encodes).toHaveLength(0);
    expect(codec.closed()).toBe(1);
  });

  it("scales a large picture to the limit and saves it as JPEG", async () => {
    const codec = fakeCodec({ width: 4000, height: 3000 });
    const image = await prepareImage(file("photo.png", "image/png", 9_000_000), 1, codec);
    expect(image).toMatchObject({ name: "photo.jpg", mediaType: "image/jpeg", width: MAX_ATTACHMENT_EDGE, height: 1176, bytes: 1000 });
    expect(codec.encodes).toEqual([{ width: MAX_ATTACHMENT_EDGE, height: 1176, quality: 0.9 }]);
  });

  it("lowers the quality, then the size, until the picture is small enough", async () => {
    // Too heavy at any quality until it has been shrunk twice.
    const codec = fakeCodec({ width: 1568, height: 1568 }, (width) => (width > 900 ? MAX_ATTACHMENT_BYTES + 1 : 500));
    const image = await prepareImage(file("dense.jpg", "image/jpeg", 8_000_000), 1, codec);
    expect(image.bytes).toBe(500);
    expect(image.width).toBe(882);
    const qualities = codec.encodes.filter((attempt) => attempt.width === 1568).map((attempt) => attempt.quality);
    expect(qualities).toEqual([0.9, 0.8, 0.7, 0.55]);
  });

  it("gives up on a picture that cannot be made small enough", async () => {
    const codec = fakeCodec({ width: 2000, height: 2000 }, () => MAX_ATTACHMENT_BYTES + 1);
    await expect(prepareImage(file("huge.jpg", "image/jpeg", 8_000_000), 1, codec)).rejects.toThrow(/too large to send/);
    expect(codec.closed()).toBe(1);
  });

  it("explains why a file is left out", async () => {
    const codec = fakeCodec({ width: 10, height: 10 });
    await expect(prepareImage(file("logo.svg", "image/svg+xml"), 1, codec)).rejects.toThrow(/PNG, JPEG, WebP or GIF/);
    await expect(prepareImage(file("empty.png", "image/png", 0), 1, codec)).rejects.toThrow(/empty/);
    await expect(prepareImage(file("big.png", "image/png", MAX_SOURCE_BYTES + 1), 1, codec)).rejects.toThrow(/too large/);
    const broken: ImageCodec = { open: () => Promise.reject(new Error("decode failed")) };
    await expect(prepareImage(file("broken.png", "image/png"), 1, broken)).rejects.toThrow(AttachmentError);
    await expect(prepareImage(file("broken.png", "image/png"), 1, broken)).rejects.toThrow(/could not be read/);
  });

  it("releases the picture even when preparing it fails", async () => {
    const close = vi.fn();
    const failing: ImageCodec = {
      open: () => Promise.resolve({ size: { width: 4000, height: 4000 }, encodeJpeg: () => Promise.reject(new Error("no canvas")), close }),
    };
    await expect(prepareImage(file("x.png", "image/png", 9_000_000), 1, failing)).rejects.toThrow(/could not be prepared/);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe("picking files out of a drag or the clipboard", () => {
  it("keeps picture files and drops the rest", () => {
    const files = [file("a.png", "image/png"), file("b.txt", "text/plain"), file("c.jpg", "image/jpeg")];
    expect(pictureFiles(files).map((item) => item.name)).toEqual(["a.png", "c.jpg"]);
    expect(pictureFiles(null)).toEqual([]);
  });

  it("recognises a drag of files", () => {
    expect(dragHasFiles({ types: ["Files"] })).toBe(true);
    expect(dragHasFiles({ types: ["text/plain"] })).toBe(false);
    expect(dragHasFiles(null)).toBe(false);
  });

  it("takes pictures from the clipboard and leaves text alone", () => {
    const screenshot = file("image.png", "image/png");
    const items = [
      { kind: "string", getAsFile: () => null },
      { kind: "file", getAsFile: () => screenshot },
      { kind: "file", getAsFile: () => file("doc.pdf", "application/pdf") },
    ];
    expect(picturesFromClipboard({ items })).toEqual([screenshot]);
    expect(picturesFromClipboard(null)).toEqual([]);
  });
});

describe("a reopened chat", () => {
  it("lists the names of the pictures a request carried", () => {
    const [user] = savedExchangesToMessages([
      { runId: "run_1", prompt: "Like this", attachments: [{ name: "front.png" }, { name: "side.jpg" }], status: "completed", createdAt: "2026-01-01T00:00:00Z" },
    ]);
    expect(user?.attachments).toEqual([
      { id: "run_1:0", name: "front.png" },
      { id: "run_1:1", name: "side.jpg" },
    ]);
  });

  it("adds nothing to a request without pictures", () => {
    const [user] = savedExchangesToMessages([{ runId: "run_2", prompt: "Hi", status: "completed", createdAt: "2026-01-01T00:00:00Z" }]);
    expect(user).not.toHaveProperty("attachments");
  });
});

describe("fitsTotal", () => {
  const MB = 1024 * 1024;
  it("accepts pictures up to the total limit and refuses one more byte", () => {
    expect(fitsTotal([], 24 * MB)).toBe(true);
    expect(fitsTotal([{ bytes: 20 * MB }], 4 * MB)).toBe(true);
    expect(fitsTotal([{ bytes: 20 * MB }], 4 * MB + 1)).toBe(false);
  });
  it("counts every picture already taken", () => {
    const taken = Array.from({ length: 8 }, () => ({ bytes: 3 * MB }));
    expect(fitsTotal(taken, 0)).toBe(true);
    expect(fitsTotal(taken, 1)).toBe(false);
  });
});
