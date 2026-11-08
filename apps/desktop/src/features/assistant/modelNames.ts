const DATE_SUFFIX = /[-_](\d{8}|\d{4}-\d{2}-\d{2})$/;
const SINGLE_NUMBER = /^\d{1,2}$/;
const VERSION = /^\d{1,2}(\.\d+)*$/;
const UPPERCASE_WORDS = new Set(["gpt", "ai", "llm"]);

/**
 * Turns a provider model id into a readable name, e.g. "claude-sonnet-4-5-20250929" into
 * "Claude Sonnet 4.5" and "gpt-5-mini" into "GPT-5 Mini". The raw id stays available for tooltips.
 */
export function formatModelName(id: string): string {
  const base = id
    .replace(/^models\//, "")
    .replace(DATE_SUFFIX, "")
    .replace(/[-_]latest$/, "");
  const tokens: string[] = [];
  for (const token of base.split(/[-_]/).filter(Boolean)) {
    const previous = tokens[tokens.length - 1];
    // Versions are split on dashes ("4-5"); join them back as "4.5".
    if (previous !== undefined && SINGLE_NUMBER.test(token) && VERSION.test(previous))
      tokens[tokens.length - 1] = `${previous}.${token}`;
    else tokens.push(token);
  }
  const words = tokens.map((token) => {
    if (/\d/.test(token)) return token;
    if (UPPERCASE_WORDS.has(token.toLowerCase())) return token.toUpperCase();
    return token.charAt(0).toUpperCase() + token.slice(1);
  });
  if (!words.length) return id;
  const [first, second, ...rest] = words;
  // "GPT-5 Mini" keeps its dash after the family name.
  if (first === "GPT" && second !== undefined) return [`GPT-${second}`, ...rest].join(" ");
  return words.join(" ");
}
