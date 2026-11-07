let active = false;
/** Whether a Knife stroke is in progress. Other shortcuts step aside while one is. */
export function knifeIsActive(): boolean {
  return active;
}
/** Records whether a Knife stroke is in progress. */
export function setKnifeActivity(value: boolean): void {
  active = value;
}
