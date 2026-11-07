import { getQuickJS } from "quickjs-emscripten";
import { z } from "zod";
import { describeIssues } from "../tool-input-issues.js";
import { editorCommandListSchema, type EditorCommand, type EditorContext } from "@movynta/editor-protocol";

export const MAX_PROGRAM_CHARACTERS = 16_000;
export const PROGRAM_TIME_LIMIT_MS = 250;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const MAX_OUTPUT_CHARACTERS = 256_000;

const outcomeSchema = z.union([
  z.object({ commands: z.unknown() }).strict(),
  z.object({ failed: z.string(), line: z.number().int().nullable() }).strict(),
]);

/**
 * The commands of a program's answer. A program that failed is reported with its own reason and line, counted
 * in the model's source (`offset` is how many wrapper lines come before it); commands that do not fit the
 * schema are reported by position and commandId.
 */
function commandsFrom(decoded: unknown, offset: number): EditorCommand[] {
  const outcome = outcomeSchema.parse(decoded);
  if ("failed" in outcome) {
    const line = outcome.line === null ? null : outcome.line - offset;
    throw new Error(line !== null && line >= 1 ? `${outcome.failed} (line ${line} of your source)` : outcome.failed);
  }
  const parsed = editorCommandListSchema.safeParse(outcome.commands);
  if (parsed.success) return parsed.data;
  const issues = describeIssues(parsed.error, outcome.commands, "commands").map(
    (issue) => `${issue.path}: ${issue.message}`,
  );
  const more =
    parsed.error.issues.length > issues.length ? `; and ${parsed.error.issues.length - issues.length} more` : "";
  throw new Error(`The returned commands do not match the command schema: ${issues.join("; ")}${more}`);
}

/** A fresh WebAssembly interpreter per call. No host functions or module loader are installed. */
export async function generateCommands(
  source: string,
  scene: EditorContext,
  signal?: AbortSignal,
): Promise<EditorCommand[]> {
  if (source.length === 0 || source.length > MAX_PROGRAM_CHARACTERS)
    throw new Error("Program must contain 1–16000 characters");
  signal?.throwIfAborted();
  const quickjs = await getQuickJS();
  signal?.throwIfAborted();
  const runtime = quickjs.newRuntime();
  runtime.setMemoryLimit(MEMORY_LIMIT_BYTES);
  runtime.setMaxStackSize(256 * 1024);
  const deadline = performance.now() + PROGRAM_TIME_LIMIT_MS;
  runtime.setInterruptHandler(() => Boolean(signal?.aborted) || performance.now() >= deadline);
  const vm = runtime.newContext();
  try {
    // Serialize inside the guest, never dump arbitrary guest objects into the host. The wrapper's
    // JSON methods are captured before user code runs, and the only imported value is plain JSON.
    // A program that throws is described inside the guest too, under the same limits, so the model
    // learns what failed and on which line of its own source.
    const prefix = `(() => {
      "use strict";
      const stringify = JSON.stringify;
      const toText = String;
      const linePattern = /scene-program\\.js:(\\d+)/;
      const scene = JSON.parse(${JSON.stringify(JSON.stringify(scene))});
      const mesh = scene.meshInspection ?? null;
      let commands;
      try {
        commands = (function(scene, mesh) { "use strict";\n`;
    const result = vm.evalCode(
      `${prefix}${source}
        })(scene, mesh);
      } catch (error) {
        let reason = "The program threw a value that cannot be read";
        let line = null;
        try {
          reason = error !== null && typeof error === "object" ? toText(error.name) + ": " + toText(error.message) : "The program threw " + toText(error);
          const found = error !== null && typeof error === "object" ? linePattern.exec(toText(error.stack)) : null;
          if (found) line = Number(found[1]);
        } catch (_) {}
        return stringify({ failed: reason.slice(0, 500), line });
      }
      if (!Array.isArray(commands)) return stringify({ failed: "Return an array of editor commands; async programs are unsupported", line: null });
      const output = stringify({ commands });
      if (output.length > ${MAX_OUTPUT_CHARACTERS}) return stringify({ failed: "Program output is too large: return fewer or smaller commands", line: null });
      return output;
    })()`,
      "scene-program.js",
    );
    if (result.error) {
      // Reading error properties from the host can invoke guest getters. Keep errors bounded and do not dump them.
      result.error.dispose();
      throw new Error(
        `Scene program stopped: it ran past ${PROGRAM_TIME_LIMIT_MS}ms, ran out of memory, or has a syntax error. Shorten loops, return fewer vertices, or check the syntax`,
      );
    }
    let output: string;
    try {
      if (vm.typeof(result.value) !== "string") throw new Error("Program must produce a JSON command array");
      output = vm.getString(result.value);
    } finally {
      result.value.dispose();
    }
    if (output.length > MAX_OUTPUT_CHARACTERS + 64) throw new Error("Program output is too large");
    return commandsFrom(JSON.parse(output), prefix.split("\n").length - 1);
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
