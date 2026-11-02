import { execFileSync } from "node:child_process";
import { cpus, platform, release, totalmem } from "node:os";

export interface BenchEnvironment {
  timestamp: string;
  commit: string;
  dirty: boolean;
  cpu: string;
  cores: number;
  ramGb: number;
  os: string;
  node: string;
  buildProfile: string;
  seedNote: string;
  command: string;
}

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

/** Everything someone needs to judge whether two result files can be compared. */
export function captureEnvironment(seed: number): BenchEnvironment {
  const processors = cpus();
  const status = git(["status", "--porcelain"]);
  return {
    timestamp: new Date().toISOString(),
    commit: git(["rev-parse", "--short", "HEAD"]),
    dirty: status !== "" && status !== "unknown",
    cpu: processors[0]?.model.trim() ?? "unknown",
    cores: processors.length,
    ramGb: Math.round(totalmem() / 1024 ** 3),
    os: `${platform()} ${release()}`,
    node: process.version,
    // Vitest transforms TypeScript on the fly and runs the optimizing JIT; the backend is its compiled build.
    buildProfile: "node JIT (optimized), backend from dist",
    seedNote: `fixtures seeded with ${seed}`,
    command: process.argv.slice(1).join(" "),
  };
}
