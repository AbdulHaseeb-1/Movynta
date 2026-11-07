/** The Knife tool's options: snapping and the angle step. */
export interface KnifeSettings {
  cutThrough: boolean;
  xray: boolean;
  angle: number;
  angleMode: number;
  measures: number;
}
/** The Knife options used before the user changes them. */
export const defaultKnifeSettings: KnifeSettings = {
  cutThrough: false,
  xray: true,
  angle: 30,
  angleMode: 0,
  measures: 0,
};

/** The snap increment typed in the Knife settings, or null while it is empty, not a number, or outside 0 to 180 degrees. */
export function parseSnapAngle(text: string): number | null {
  if (text.trim() === "") return null;
  const angle = Number(text);
  return Number.isFinite(angle) && angle > 0 && angle <= 180 ? angle : null;
}
