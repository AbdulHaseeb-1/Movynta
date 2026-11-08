import { MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_TOTAL_BYTES, MAX_ATTACHMENTS } from "@movynta/contracts";
import { ValidationFailedError } from "../../common/errors/app-error.js";
import { pictureUpload as upload } from "../../testing/pictures.js";
import { checkAttachments, cleanAttachmentName, messageWithAttachments, summarizeAttachments } from "./run-attachments.js";

describe("checkAttachments", () => {
  it.each(["image/png", "image/jpeg", "image/gif", "image/webp"] as const)("accepts a real %s", (mediaType) => {
    const [checked] = checkAttachments([upload(mediaType, 100)]);
    expect(checked).toMatchObject({ mediaType, bytes: 100 });
  });

  it("reports the decoded size, with and without base64 padding", () => {
    expect(checkAttachments([upload("image/png", 10)])[0]?.bytes).toBe(10);
    expect(checkAttachments([upload("image/png", 11)])[0]?.bytes).toBe(11);
    expect(checkAttachments([upload("image/png", 12)])[0]?.bytes).toBe(12);
  });

  it("takes the type from the bytes, not from the claim", () => {
    expect(() => checkAttachments([{ ...upload("image/jpeg"), mediaType: "image/png" }])).toThrow(/not a PNG image/);
    expect(() => checkAttachments([{ ...upload("image/png"), mediaType: "image/webp" }])).toThrow(/not a WEBP image/);
  });

  it("rejects text that is not base64", () => {
    expect(() => checkAttachments([{ name: "a.png", mediaType: "image/png", data: "not base64!!" }])).toThrow(ValidationFailedError);
    expect(() => checkAttachments([{ name: "a.png", mediaType: "image/png", data: "abc" }])).toThrow(/not a valid image/);
    expect(() => checkAttachments([{ name: "a.png", mediaType: "image/png", data: "data:image/png;base64,AAAA" }])).toThrow(/not a valid image/);
  });

  it("rejects a picture over the size limit and accepts one at the limit", () => {
    expect(checkAttachments([upload("image/png", MAX_ATTACHMENT_BYTES)])).toHaveLength(1);
    expect(() => checkAttachments([upload("image/png", MAX_ATTACHMENT_BYTES + 1)])).toThrow(/larger than 5 MB/);
  });

  it("rejects more pictures than a request may carry", () => {
    const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, () => upload("image/png"));
    expect(() => checkAttachments(many)).toThrow(new RegExp(`at most ${MAX_ATTACHMENTS} images`));
    expect(checkAttachments(many.slice(0, MAX_ATTACHMENTS))).toHaveLength(MAX_ATTACHMENTS);
  });

  it("accepts a full set of pictures that fit together, and refuses a set that is too large together", () => {
    const each = Math.floor(MAX_ATTACHMENT_TOTAL_BYTES / MAX_ATTACHMENTS);
    expect(checkAttachments(Array.from({ length: MAX_ATTACHMENTS }, () => upload("image/png", each)))).toHaveLength(MAX_ATTACHMENTS);
    // Each picture is within its own limit; together they are not.
    const heavy = Array.from({ length: 5 }, () => upload("image/png", MAX_ATTACHMENT_BYTES));
    expect(() => checkAttachments(heavy)).toThrow(/add up to more than 24 MB/);
  });

  it("names the picture that failed", () => {
    expect(() => checkAttachments([upload("image/png"), { name: "broken.jpg", mediaType: "image/jpeg", data: "AAAA" }])).toThrow(/"broken.jpg"/);
  });
});

describe("cleanAttachmentName", () => {
  it("drops folders, control characters and extra spaces", () => {
    expect(cleanAttachmentName("C:\\Users\\me\\Pictures\\robot  front.png")).toBe("robot front.png");
    expect(cleanAttachmentName("../../etc/passwd")).toBe("passwd");
    expect(cleanAttachmentName("line\nbreak\u0000.png")).toBe("linebreak.png");
  });

  it("never returns an empty or long name", () => {
    expect(cleanAttachmentName("   ")).toBe("image");
    expect(cleanAttachmentName("folder/")).toBe("image");
    expect(cleanAttachmentName("x".repeat(500))).toHaveLength(120);
  });
});

describe("messageWithAttachments", () => {
  it("puts the message first and numbers each picture before it", () => {
    const attachments = checkAttachments([upload("image/png", 8, "front.png"), upload("image/jpeg", 8, "side.jpg")]);
    const [item] = messageWithAttachments("Make it like this", attachments);
    expect(item).toMatchObject({ role: "user" });
    const content = "content" in (item ?? {}) ? (item as { content: unknown[] }).content : [];
    expect(content).toEqual([
      { type: "input_text", text: "Make it like this" },
      { type: "input_text", text: "Attached image 1 of 2: front.png" },
      { type: "input_image", image: expect.stringMatching(/^data:image\/png;base64,/) },
      { type: "input_text", text: "Attached image 2 of 2: side.jpg" },
      { type: "input_image", image: expect.stringMatching(/^data:image\/jpeg;base64,/) },
    ]);
  });

  it("keeps the names, types and sizes but not the pixels", () => {
    const summary = summarizeAttachments(checkAttachments([upload("image/png", 20, "a.png")]));
    expect(summary).toEqual([{ name: "a.png", mediaType: "image/png", bytes: 20 }]);
    expect(JSON.stringify(summary)).not.toContain("data");
  });
});
