/**
 * Whether `text` matches `pattern`, where `*` stands for any run of characters and `?` for one character. Case is
 * ignored. Done without a regular expression, so a pattern with many stars cannot make a search crawl.
 */
export function globMatches(pattern: string, text: string): boolean {
  const p = pattern.toLowerCase();
  const t = text.toLowerCase();
  let pi = 0;
  let ti = 0;
  let starAt = -1;
  let resumeAt = 0;
  while (ti < t.length) {
    const wanted = p[pi];
    if (wanted === "*") {
      starAt = pi;
      resumeAt = ti;
      pi += 1;
    } else if (wanted !== undefined && (wanted === "?" || wanted === t[ti])) {
      pi += 1;
      ti += 1;
    } else if (starAt >= 0) {
      // Let the last star take one more character and try again from there.
      resumeAt += 1;
      ti = resumeAt;
      pi = starAt + 1;
    } else {
      return false;
    }
  }
  while (p[pi] === "*") pi += 1;
  return pi === p.length;
}
