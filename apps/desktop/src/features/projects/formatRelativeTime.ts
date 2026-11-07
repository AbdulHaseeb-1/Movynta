const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const relative = new Intl.RelativeTimeFormat("en", {
  numeric: "auto",
  style: "short",
});
const calendar = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
});
const calendarWithYear = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

/**
 * A short, human time for "when was this last touched": "Just now", "5 min. ago", "yesterday",
 * "3 days ago", then a calendar date. Dates in the future (a clock skew) read as "Just now".
 */
export function formatRelativeTime(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const elapsed = Math.max(0, now - time);
  if (elapsed < MINUTE) return "Just now";
  if (elapsed < HOUR) return relative.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return relative.format(-Math.floor(elapsed / HOUR), "hour");
  if (elapsed < 7 * DAY) return relative.format(-Math.floor(elapsed / DAY), "day");
  const date = new Date(time);
  return (date.getFullYear() === new Date(now).getFullYear() ? calendar : calendarWithYear).format(date);
}
