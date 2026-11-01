import { Color } from "three";

export type ThemeToken =
  | "background"
  | "foreground"
  | "card"
  | "muted"
  | "secondary"
  | "accent"
  | "muted-foreground"
  | "ring"
  | "brand"
  | "character";

/** Neutral grey used only if a token cannot be read (for example before styles load). */
const FALLBACK = new Color(0.5, 0.5, 0.5);

/**
 * Reads a palette token from the page's CSS so 3D materials follow the same palette as the UI, with no
 * hex values of their own. Only the solid tokens (not the translucent ones) are valid here.
 */
export function themeColor(token: ThemeToken): Color {
  if (typeof document === "undefined") return FALLBACK.clone();
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${token}`).trim();
  if (value === "") return FALLBACK.clone();
  try {
    return new Color(value);
  } catch {
    return FALLBACK.clone();
  }
}
