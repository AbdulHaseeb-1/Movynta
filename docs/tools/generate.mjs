#!/usr/bin/env node
// Writes the assistant tool reference in docs/tools from the data the desktop app shows.
// Edit apps/desktop/src/features/documentation/assistantTools/assistantTools.json, then run:
//   node docs/tools/generate.mjs           write the files
//   node docs/tools/generate.mjs --check   fail if the files are out of date
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../../apps/desktop/src/features/documentation/assistantTools/assistantTools.json");
const data = JSON.parse(readFileSync(source, "utf8"));
const checkOnly = process.argv.includes("--check");

const TYPE_LABELS = Object.fromEntries(data.types.map((type) => [type.id, type.label]));
const toolsByName = new Map(data.tools.map((tool) => [tool.name, tool]));

const json = (value) => JSON.stringify(value, null, 2);
const cell = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
const label = (text) => text.replace(/"/g, "'");
const requiredLabel = (row) => (row.required === undefined ? "–" : row.required ? "Yes" : "No");
const example = (value) => (value === "$scene" ? data.scene : value);
const toolLink = (name) => (toolsByName.has(name) ? `[\`${name}\`](${toolsByName.get(name).doc})` : `\`${name}\``);

function mermaid(steps) {
  const nodes = steps.map((step, index) => `  S${index}["${label(step)}"]`);
  const edges = steps.slice(1).map((_, index) => `  S${index} --> S${index + 1}`);
  return ["```mermaid", "flowchart LR", ...nodes, ...edges, "```"];
}

function toolPage(tool) {
  const out = [];
  out.push(`# \`${tool.name}\``, "", `> ${tool.summary}`, "");
  out.push("| | |", "| --- | --- |");
  out.push(`| Provider name | \`${tool.provider}\` |`);
  out.push(`| Type | ${TYPE_LABELS[tool.type]} (permission \`${tool.permission}\`) |`);
  out.push(`| Approval | ${cell(tool.approval)} |`);
  out.push(`| Needs the editor | ${tool.needsEditor ? "Yes" : "No"} |`);
  out.push(`| Example | ${tool.verify === "code" ? "Checked by the backend test on the sample scene" : "Live editor output; the test checks its shape"} |`);
  out.push(`| Defined in | \`${tool.source}\` |`);
  out.push(`| In the app | Documentation → Assistant tools → ${TYPE_LABELS[tool.type]} |`, "");

  out.push("## When the assistant uses it", "", ...tool.when.map((item) => `- ${item}`), "");

  out.push("## Input", "");
  if (tool.input.note) out.push(tool.input.note, "");
  if (tool.input.rows.length > 0) {
    out.push("| Name | Type | Required | Default | Meaning |", "| --- | --- | --- | --- | --- |");
    for (const row of tool.input.rows) {
      out.push(`| \`${row.name}\` | ${cell(row.type)} | ${requiredLabel(row)} | ${row.default ? `\`${row.default}\`` : "–"} | ${cell(row.meaning)} |`);
    }
    out.push("");
  }

  for (const section of tool.details ?? []) {
    out.push(`## ${section.title}`, "", "| Item | Meaning |", "| --- | --- |");
    for (const row of section.rows) out.push(`| \`${row.label}\` | ${cell(row.meaning)} |`);
    out.push("");
  }

  out.push("## Result", "");
  if (tool.result.note) out.push(tool.result.note, "");
  out.push("| Field | Meaning |", "| --- | --- |");
  for (const row of tool.result.rows) out.push(`| \`${row.field}\` | ${cell(row.meaning)} |`);
  out.push("");

  out.push("## Example", "");
  const request = tool.request;
  const program = typeof request?.source === "string" ? request.source : null;
  if (program !== null) out.push("Program:", "", "```js", program, "```", "");
  const rest = program !== null ? Object.fromEntries(Object.entries(request).filter(([key]) => key !== "source")) : request;
  if (program === null || Object.keys(rest).length > 0) out.push("Request:", "", "```json", json(rest), "```", "");
  out.push("Result:", "", "```json", json(example(tool.response)), "```", "");

  if (tool.flow && tool.flow.length > 0) out.push("## How it fits", "", ...mermaid(tool.flow), "");

  out.push("## Tips", "", ...tool.tips.map((tip) => `- ${tip}`), "");
  out.push("## Limits", "", ...tool.limits.map((limit) => `- ${limit}`), "");

  if (tool.errors && tool.errors.length > 0) {
    out.push("## Errors you may see", "", "| Message | Cause |", "| --- | --- |");
    for (const error of tool.errors) out.push(`| \`${cell(error.message)}\` | ${cell(error.cause)} |`);
    out.push("");
  }

  out.push("## Related", "", ...tool.related.map((name) => `- ${toolLink(name)}`), "");
  return out.join("\n");
}

function indexPage() {
  const out = [];
  out.push("# Assistant tools: reference", "", data.intro, "");
  out.push(
    "This folder is generated from [`assistantTools.json`](../../apps/desktop/src/features/documentation/assistantTools/assistantTools.json), which is also what the desktop app shows under **Documentation → Assistant tools**. Change the JSON, then run `node docs/tools/generate.mjs`.",
    "",
    "The backend test `apps/backend/src/modules/tools/tool-docs.spec.ts` runs the tools on the sample scene below and checks the examples against the code.",
    "",
  );

  out.push("## Rules", "", ...data.rules.map((rule, index) => `${index + 1}. ${rule}`), "");

  out.push("## Tool types", "", "| Type | What it does | Tools |", "| --- | --- | --- |");
  for (const type of data.types) {
    const names = data.tools.filter((tool) => tool.type === type.id).map((tool) => toolLink(tool.name));
    out.push(`| **${type.label}** | ${cell(type.hint)} | ${names.join(", ")} |`);
  }
  out.push("");

  out.push("## The sample scene", "", "Every example uses this scene, at revision " + data.scene.revision + ", with `" + data.scene.selectedObjectIds.join("`, `") + "` selected.", "");
  out.push("| Object | id | Type | Parent | World bounds (min → max) |", "| --- | --- | --- | --- | --- |");
  for (const object of data.scene.objects) {
    const bounds = object.worldBounds ? `\`${JSON.stringify(object.worldBounds.min)}\` → \`${JSON.stringify(object.worldBounds.max)}\`` : "no geometry";
    out.push(`| ${object.name} | \`${object.id}\` | \`${object.type}\` | ${object.parentId ? `\`${object.parentId}\`` : "none"} | ${bounds} |`);
  }
  out.push("");

  out.push("## Conventions", "", "| Term | Meaning |", "| --- | --- |");
  for (const convention of data.conventions) out.push(`| ${convention.term} | ${cell(convention.meaning)} |`);
  out.push("");

  out.push("## Tools", "");
  for (const type of data.types) {
    const tools = data.tools.filter((tool) => tool.type === type.id);
    if (tools.length === 0) continue;
    out.push(`### ${type.label}`, "");
    for (const tool of tools) out.push(`- ${toolLink(tool.name)}: ${tool.summary}`);
    out.push("");
  }
  return out.join("\n");
}

const outputs = new Map([["README.md", indexPage()]]);
for (const tool of data.tools) outputs.set(tool.doc, toolPage(tool));

let stale = [];
for (const [file, content] of outputs) {
  const path = resolve(here, file);
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (current === content) continue;
  if (checkOnly) {
    stale.push(file);
  } else {
    writeFileSync(path, content);
    console.log(`wrote docs/tools/${file}`);
  }
}

if (checkOnly) {
  if (stale.length > 0) {
    console.error(`Out of date: ${stale.join(", ")}. Run node docs/tools/generate.mjs`);
    process.exit(1);
  }
  console.log("docs/tools is up to date");
}
