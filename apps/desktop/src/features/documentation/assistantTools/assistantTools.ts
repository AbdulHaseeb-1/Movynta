import type { EditorContext } from "@movynta/editor-protocol";
import raw from "./assistantTools.json";
import {
  assistantToolDocumentSchema,
  type AssistantTool,
  type AssistantToolDocument,
  type AssistantToolType,
} from "./assistantTools.schema";

/** The reference, checked when this module loads so a malformed edit to the JSON fails at once. */
export const assistantToolDocument: AssistantToolDocument = assistantToolDocumentSchema.parse(raw);

/** The DOM id of a tool's card. Used for scrolling; the app uses hash routing, so ids are never link targets. */
export function toolAnchor(name: string): string {
  return `tool-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

/** The tools of one type, such as Read or Apply, in document order. */
export function toolsOfType(document: AssistantToolDocument, type: AssistantToolType): AssistantTool[] {
  return document.tools.filter((tool) => tool.type === type);
}

/** The example result, with "$scene" replaced by the sample scene. */
export function exampleResponse(tool: AssistantTool, scene: EditorContext): unknown {
  return tool.response === "$scene" ? scene : tool.response;
}

/** Whether a tool mentions the search term anywhere a reader would look for it. The term must already be lower case. */
export function matchesTool(tool: AssistantTool, term: string): boolean {
  const text = [
    tool.name,
    tool.provider,
    tool.permission,
    tool.summary,
    tool.group ?? "",
    ...tool.when,
    ...tool.tips,
    ...tool.limits,
    ...tool.related,
    ...tool.input.rows.map((row) => `${row.name} ${row.meaning}`),
    ...tool.result.rows.map((row) => `${row.field} ${row.meaning}`),
    ...(tool.details ?? []).flatMap((section) => [
      section.title,
      ...section.rows.map((row) => `${row.label} ${row.meaning}`),
    ]),
  ]
    .join(" ")
    .toLowerCase();
  return text.includes(term);
}
