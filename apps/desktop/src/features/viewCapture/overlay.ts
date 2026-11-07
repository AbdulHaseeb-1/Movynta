import { isInFrame, type PixelRect } from "./screenBounds";

/** One object to mark on a picture. */
export interface OverlayItem {
  id: string;
  rect: PixelRect | null;
  /** Boxed in the highlight colour, as the assistant asked. */
  highlighted: boolean;
}

/** The options of the labels and highlights drawn on a captured view. */
export interface OverlayOptions {
  items: readonly OverlayItem[];
  /** Write each object's id next to it. */
  labels: boolean;
  /** Names the view, bottom left. */
  caption: string;
}

/** The colour of the highlights drawn on a captured view. */
export const HIGHLIGHT_COLOR = "#ff9b21";
const LABEL_TEXT = "#f4f6fa";
const LABEL_BACKGROUND = "rgba(8, 10, 14, 0.72)";
/** The most labels written on one picture, largest objects first, so a busy scene stays readable. */
const MAX_LABELS = 40;

function area(rect: PixelRect | null): number {
  return rect ? rect.width * rect.height : 0;
}

/** Writes `text` on a dark pill whose top-left corner is as near (x, y) as the picture allows. */
function drawTag(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
  fontSize: number,
): void {
  const padding = Math.round(fontSize * 0.3);
  const tagWidth = context.measureText(text).width + padding * 2;
  const tagHeight = fontSize + padding * 2;
  const left = Math.min(Math.max(x, 0), Math.max(width - tagWidth, 0));
  const top = Math.min(Math.max(y, 0), Math.max(height - tagHeight, 0));
  context.fillStyle = LABEL_BACKGROUND;
  context.fillRect(left, top, tagWidth, tagHeight);
  context.fillStyle = color;
  context.fillText(text, left + padding, top + padding);
}

/** Marks objects and names the view on a finished picture, so what the assistant sees can be tied to ids. */
export function drawOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: OverlayOptions,
): void {
  const fontSize = Math.max(11, Math.round(Math.min(width, height) / 48));
  context.save();
  context.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
  context.textBaseline = "top";

  context.lineWidth = Math.max(2, Math.round(fontSize / 5));
  context.strokeStyle = HIGHLIGHT_COLOR;
  for (const item of options.items) {
    if (item.highlighted && item.rect && isInFrame(item.rect, width, height)) {
      context.strokeRect(item.rect.x, item.rect.y, item.rect.width, item.rect.height);
    }
  }

  if (options.labels) {
    const visible = options.items.filter((item) => isInFrame(item.rect, width, height));
    visible.sort((a, b) => area(b.rect) - area(a.rect));
    for (const item of visible.slice(0, MAX_LABELS)) {
      if (!item.rect) continue;
      drawTag(
        context,
        item.id,
        item.rect.x,
        item.rect.y,
        width,
        height,
        item.highlighted ? HIGHLIGHT_COLOR : LABEL_TEXT,
        fontSize,
      );
    }
  }

  drawTag(context, options.caption, 0, height, width, height, LABEL_TEXT, fontSize);
  context.restore();
}
