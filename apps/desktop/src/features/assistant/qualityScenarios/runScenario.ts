import { Scene } from "three";
import { editorContextSchema, type EditorContext } from "@movynta/editor-protocol";
import { EditorScene } from "../EditorScene";
import { scenarioById } from "./scenarios";
import type { QualityScenario, ScenarioCommand, ScenarioOutcome } from "./types";

/** Runs a batch on the real editor and fails loudly if it is not applied: a scenario that cannot be built proves nothing. */
export function applyScenarioCommands(editor: EditorScene, label: string, commands: readonly ScenarioCommand[]): void {
  if (commands.length === 0) return;
  const result = editor.execute(`${label}-${editor.currentRevision}`, editor.currentRevision, commands);
  if (result.status !== "applied") {
    const failed = "results" in result ? JSON.stringify(result.results) : "";
    throw new Error(`The ${label} commands were ${result.status}. ${failed}`.trim());
  }
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
  const openEdges: Record<string, number> = {};
  for (const id of scenario.closed ?? []) {
    const stats = snapshotOf(editor, { objectId: id, meshPath: [], view: "base", offset: 0, limit: 1, includeSamples: false }).meshInspection?.stats;
    if (stats) openEdges[id] = stats.boundaryEdges + stats.nonManifoldEdges;
  }
  return { before, after: snapshotOf(editor), openEdges };
}

/** Builds a scenario's known answer, or one of its defective answers, in the real editor. */
export function buildScenario(scenarioId: string, defectId?: string): ScenarioOutcome {
  const scenario = scenarioById(scenarioId);
  const editor = startScenario(scenario);
  const before = snapshotOf(editor);
  applyScenarioCommands(editor, defectId ?? "solution", scenario.solution(defectId));
  return observeOutcome(editor, scenario, before);
}
