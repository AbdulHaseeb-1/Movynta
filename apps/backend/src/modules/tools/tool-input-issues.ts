import type { z } from "zod";

/** One reason a tool call was refused, in a form a model can act on: where, and what is wrong there. */
export interface ToolInputIssue {
  readonly path: string;
  readonly message: string;
}

/** Most issues reported for one call. The first ones are enough to correct it; the rest repeat the pattern. */
export const MAX_REPORTED_ISSUES = 8;
const MAX_MESSAGE_LENGTH = 300;
const MAX_SUGGESTIONS = 3;

type PathKey = PropertyKey;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value at `path` inside `input`, or undefined when the path leaves it. */
function valueAt(input: unknown, path: readonly PathKey[]): unknown {
  let current: unknown = input;
  for (const key of path) {
    if (Array.isArray(current) && typeof key === "number") current = current[key];
    else if (isRecord(current) && typeof key === "string") current = current[key];
    else return undefined;
  }
  return current;
}

/**
 * `commands[2] (commandId "lid").transform.scale`: array indexes in brackets, and the commandId of the command a
 * path runs through, so a batch can be corrected without counting entries.
 */
export function formatIssuePath(path: readonly PathKey[], input?: unknown): string {
  let text = "";
  path.forEach((key, index) => {
    if (typeof key === "number") {
      text += `[${key}]`;
      const entry = valueAt(input, path.slice(0, index + 1));
      const commandId = isRecord(entry) ? entry["commandId"] : undefined;
      if (typeof commandId === "string" && commandId.length <= 64) text += ` (commandId "${commandId}")`;
    } else {
      const name = typeof key === "symbol" ? (key.description ?? "") : key;
      text += text === "" ? name : `.${name}`;
    }
  });
  return text === "" ? "(arguments)" : text;
}

/** Edit distance between two short strings, for suggesting the name that was probably meant. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current.push(Math.min((previous[j] ?? 0) + 1, (current[j - 1] ?? 0) + 1, (previous[j - 1] ?? 0) + cost));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** The valid values closest to what was sent, nearest first. */
export function closestValues(received: string, options: readonly string[]): string[] {
  return [...options]
    .map((option) => ({ option, score: distance(received.toLowerCase(), option.toLowerCase()) }))
    .sort((left, right) => left.score - right.score || left.option.localeCompare(right.option))
    .slice(0, MAX_SUGGESTIONS)
    .map((entry) => entry.option);
}

function quoted(value: unknown): string {
  if (typeof value === "string") return `"${value.slice(0, 80)}"`;
  if (value === undefined) return "nothing";
  try {
    return JSON.stringify(value).slice(0, 80);
  } catch {
    return "an unreadable value";
  }
}

/** The options a discriminated union accepts, read without trusting the shape of the issue. */
function discriminatorOptions(issue: z.core.$ZodIssue): string[] {
  if (issue.code !== "invalid_union" || !("options" in issue) || !Array.isArray(issue.options)) return [];
  return issue.options.filter((option): option is string => typeof option === "string");
}

/** A short message for one issue. A long list of allowed values becomes the value sent and the closest matches. */
function messageFor(issue: z.core.$ZodIssue, input: unknown): string {
  const options = discriminatorOptions(issue);
  if (options.length > 0) {
    const received = valueAt(input, issue.path);
    const suggestions = typeof received === "string" ? closestValues(received, options) : options.slice(0, MAX_SUGGESTIONS);
    return `Unknown value ${quoted(received)}. Closest valid values: ${suggestions.join(", ")}`;
  }
  if (issue.code === "invalid_value" && issue.values.length > 6) {
    const received = valueAt(input, issue.path);
    const allowed = issue.values.filter((value): value is string => typeof value === "string");
    if (typeof received === "string" && allowed.length > 0)
      return `Unknown value ${quoted(received)}. Closest valid values: ${closestValues(received, allowed).join(", ")}`;
  }
  return issue.message.slice(0, MAX_MESSAGE_LENGTH);
}

/**
 * The issues of a schema failure, located and shortened, at most {@link MAX_REPORTED_ISSUES} of them. `root` names
 * the value that was checked when it is not the arguments themselves, such as the `commands` a program returned.
 */
export function describeIssues(error: z.ZodError, input?: unknown, root?: string): ToolInputIssue[] {
  const scope = root === undefined ? input : { [root]: input };
  return error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = root === undefined ? issue.path : [root, ...issue.path];
    return { path: formatIssuePath(path, scope), message: messageFor({ ...issue, path }, scope) };
  });
}

/** What the model is told when a call is refused by the tool's schema. */
export function invalidInputResult(error: z.ZodError, input: unknown) {
  const issues = describeIssues(error, input);
  return {
    error: "The arguments do not match this tool's schema. Fix each listed field and call again; nothing was changed.",
    issues,
    ...(error.issues.length > issues.length ? { moreIssues: error.issues.length - issues.length } : {}),
  };
}
