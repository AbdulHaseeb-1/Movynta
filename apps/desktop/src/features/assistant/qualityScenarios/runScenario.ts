import { Scene } from "three";
import { editorContextSchema, isCageEditCommand, type EditorContext } from "@movynta/editor-protocol";
import { EditorScene } from "../EditorScene";
import { measureMesh } from "./meshMeasure";
import { scenarioById } from "./scenarios";
import type { MeshMeasure, QualityScenario, ScenarioCommand, ScenarioOutcome } from "./types";

function applyBatch(editor: EditorScene, label: string, commands: readonly ScenarioCommand[]): void {
  const result = editor.execute(`${label}-${editor.currentRevision}`, editor.currentRevision, commands);
  if (result.status !== "applied") {
    const failed = "results" in result ? JSON.stringify(result.results) : "";
    throw new Error(`The ${label} commands were ${result.status}. ${failed}`.trim());
  }
}

/**
 * Runs commands on the real editor, and fails loudly if a batch is not applied: a scenario that cannot be built proves
 * nothing. A command that edits a mesh's cage is applied alone, as the assistant can always send it (some renumber the
 * mesh, and none may share a batch with creation), so a known answer never relies on a grouping the assistant could
 * not use.
 */
export function applyScenarioCommands(editor: EditorScene, label: string, commands: readonly ScenarioCommand[]): void {
  let pending: ScenarioCommand[] = [];
  const flush = () => {
    if (pending.length > 0) applyBatch(editor, label, pending);
    pending = [];
  };
  for (const command of commands) {
    if (isCageEditCommand({ type: String(command["type"]) })) {
      flush();
      applyBatch(editor, label, [command]);
    } else {
      pending.push(command);
    }
  }
  flush();
}

/** The editor's snapshot as the protocol defines it. Parsing proves the snapshot is a valid payload, not just a typed one. */
export function snapshotOf(editor: EditorScene, inspection?: Parameters<EditorScene["context"]>[0]): EditorContext {
  return editorContextSchema.parse(editor.context(inspection));
}

/** A new editor holding the scene the scenario's request starts from. */
export function startScenario(scenario: QualityScenario): EditorScene {
  const editor = new EditorScene(new Scene(), `quality-${scenario.id}`);
  applyScenarioCommands(editor, "setup", scenario.setup);
  return editor;
}

/** Reads the end state of a run: the scene and how open each solid is. Works on any editor, scripted or driven by a live model. */
export function observeOutcome(editor: EditorScene, scenario: QualityScenario, before: EditorContext): ScenarioOutcome {
  const meshes: Record<string, MeshMeasure> = {};
  for (const check of scenario.meshChecks ?? []) {
    const measured = meshes[check.objectId] ?? measureMesh(editor, check.objectId);
    if (measured) meshes[check.objectId] = measured;
  }
  return { before, after: snapshotOf(editor), meshes };
}

/** Builds a scenario's known answer, or one of its defective answers, in the real editor. */
export function buildScenario(scenarioId: string, defectId?: string): ScenarioOutcome {
  const scenario = scenarioById(scenarioId);
  const editor = startScenario(scenario);
  const before = snapshotOf(editor);
  applyScenarioCommands(editor, defectId ?? "solution", scenario.solution(defectId));
  return observeOutcome(editor, scenario, before);
}
