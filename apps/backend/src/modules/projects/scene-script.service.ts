import { Injectable } from "@nestjs/common";
import {
  editorContextSchema,
  validateAgainstContext,
} from "@movynta/editor-protocol";
import { z } from "zod";
import { ValidationFailedError } from "../../common/errors/app-error.js";
import {
  generateCommands,
  MAX_PROGRAM_CHARACTERS,
} from "../tools/procedural/procedural.runner.js";

const scriptInput = z
  .object({
    source: z.string().min(1).max(MAX_PROGRAM_CHARACTERS),
    scene: editorContextSchema,
  })
  .strict();

/** Generates commands without giving the script access to the backend or applying any edits. */
@Injectable()
export class SceneScriptService {
  async generate(projectId: string, input: unknown) {
    const parsed = scriptInput.safeParse(input);
    if (!parsed.success || parsed.data.scene.projectId !== projectId)
      throw new ValidationFailedError("Invalid script or scene snapshot.");
    const { source, scene } = parsed.data;
    try {
      const commands = await generateCommands(source, scene);
      const issues = validateAgainstContext(commands, scene);
      if (issues.length)
        throw new Error(issues.map((issue) => issue.message).join("; "));
      return { commands, revision: scene.revision };
    } catch (error) {
      throw new ValidationFailedError(
        error instanceof Error ? error.message : "Script failed.",
      );
    }
  }
}
