/** One image a tool hands to the model. `data` is base64 text without a data: prefix. */
export interface ToolImage {
  readonly data: string;
  readonly mediaType: string;
}

/** A piece of tool output in the shape the Agents SDK passes on to the model. */
export type ToolOutputPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image"; readonly image: { readonly data: string; readonly mediaType: string } };

/**
 * A tool result that carries images along with text. Other results are plain JSON; use this only
 * where the model has to see pixels, since every image costs tokens on each call that follows.
 */
export class RichToolResult {
  readonly text: string;
  readonly images: readonly ToolImage[];

  constructor(text: string, images: readonly ToolImage[]) {
    this.text = text;
    this.images = images;
  }

  /** The text first, then each image in order. */
  parts(): ToolOutputPart[] {
    return [
      { type: "text", text: this.text },
      ...this.images.map(
        (image): ToolOutputPart => ({ type: "image", image: { data: image.data, mediaType: image.mediaType } }),
      ),
    ];
  }
}
