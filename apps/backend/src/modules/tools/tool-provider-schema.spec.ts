import { createEditorTools } from "./editor/editor.tools.js";
import { createModelingTools } from "./modeling/modeling.tools.js";
import { toSdkTool } from "./tool.sdk-adapter.js";

/** Collects every place a JSON schema uses a construct that model providers reject in tool definitions. */
function problems(schema: unknown, path = "#"): string[] {
  if (Array.isArray(schema)) return schema.flatMap((item, index) => problems(item, `${path}/${index}`));
  if (typeof schema !== "object" || schema === null) return [];
  const found: string[] = [];
  const record = schema as Record<string, unknown>;
  if (Array.isArray(record["items"])) found.push(`${path}: tuple "items" array`);
  if ("prefixItems" in record) found.push(`${path}: "prefixItems"`);
  for (const [key, value] of Object.entries(record)) found.push(...problems(value, `${path}/${key}`));
  return found;
}

describe("tool schemas sent to model providers", () => {
  const tools = [
    ...createEditorTools({ bridge: {} as never, proposals: {} as never }),
    ...createModelingTools({ knownToolNames: [] }),
  ];

  it.each(tools.map((definition) => [definition.name, definition] as const))("%s has a provider-compatible schema", (_name, definition) => {
    const sdkTool = toSdkTool(definition);
    expect(problems(sdkTool.parameters)).toEqual([]);
  });
});
