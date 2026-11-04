import { getQuickJS } from "quickjs-emscripten";
import { editorCommandListSchema } from "../../../shared/schemas/editor-command.schema.js";
import type { EditorCommand } from "../../../shared/types/editor-command.types.js";
import type { EditorContext } from "../../../shared/types/editor-context.types.js";

export const MAX_PROGRAM_CHARACTERS = 16_000;
export const PROGRAM_TIME_LIMIT_MS = 250;
const MEMORY_LIMIT_BYTES = 16 * 1024 * 1024;
const MAX_OUTPUT_CHARACTERS = 256_000;

/** A fresh WebAssembly interpreter per call. No host functions or module loader are installed. */
export async function generateCommands(source: string, scene: EditorContext, signal?: AbortSignal): Promise<EditorCommand[]> {
  if (source.length === 0 || source.length > MAX_PROGRAM_CHARACTERS) throw new Error("Program must contain 1–16000 characters");
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
    const result = vm.evalCode(`(() => {
      "use strict";
      const stringify = JSON.stringify;
      const scene = JSON.parse(${JSON.stringify(JSON.stringify(scene))});
      const mesh = scene.meshInspection ?? null;
      const commands = (function(scene, mesh) { "use strict";\n${source}\n})(scene, mesh);
      if (!Array.isArray(commands)) throw new Error("Return an array of editor commands; async programs are unsupported");
      const output = stringify(commands);
      if (output.length > ${MAX_OUTPUT_CHARACTERS}) throw new Error("Program output is too large");
      return output;
    })()`, "scene-program.js");
    if (result.error) {
      // Reading error properties can invoke guest getters. Keep errors bounded and do not dump them.
      result.error.dispose();
      throw new Error("Scene program failed: check syntax, return a command array, and stay within time/memory/output limits");
    }
    let output: string;
    try {
      if (vm.typeof(result.value) !== "string") throw new Error("Program must produce a JSON command array");
      output = vm.getString(result.value);
    } finally {
      result.value.dispose();
    }
    if (output.length > MAX_OUTPUT_CHARACTERS) throw new Error("Program output is too large");
    const decoded: unknown = JSON.parse(output);
    return editorCommandListSchema.parse(decoded);
  } finally {
    vm.dispose();
    runtime.dispose();
  }
}
