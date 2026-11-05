import type { ReactNode } from "react";
import type { EditorContext } from "@movynta/editor-protocol";
import { Badge, Button } from "@/components/ui";
import { exampleResponse, toolAnchor } from "../assistantTools/assistantTools";
import type { AssistantTool, AssistantToolInputRow } from "../assistantTools/assistantTools.schema";
import { CodeBlock } from "./CodeBlock";
import { isRecord } from "./format";
import { ToolVisual } from "./ToolVisual";

interface AssistantToolCardProps {
  readonly tool: AssistantTool;
  readonly scene: EditorContext;
  readonly typeLabel: string;
  readonly onOpenTool: (name: string) => void;
}

/** One tool's reference: what it does, its input and result, a worked example, a picture and its limits. */
export function AssistantToolCard({ tool, scene, typeLabel, onOpenTool }: AssistantToolCardProps) {
  return (
    <article id={toolAnchor(tool.name)} className="scroll-mt-6 rounded-xl border border-border bg-card p-5 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-mono text-base font-semibold">{tool.name}</h3>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{tool.provider}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{typeLabel}</Badge>
          <Badge variant="outline">{tool.approval}</Badge>
          <Badge variant="outline">{tool.needsEditor ? "Needs the editor" : "No editor needed"}</Badge>
          <Badge variant={tool.verify === "code" ? "success" : "accent"}>{tool.verify === "code" ? "Checked by tests" : "Live editor output"}</Badge>
        </div>
      </header>

      <p className="mt-3 text-sm leading-6 text-muted-foreground">{tool.summary}</p>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-6">
          <Section title="When the assistant uses it">
            <ul className="space-y-2 text-sm leading-6">
              {tool.when.map((item) => <li key={item} className="flex gap-2"><span aria-hidden className="text-brand">▸</span><span>{item}</span></li>)}
            </ul>
          </Section>
          {tool.flow && tool.flow.length > 0 && (
            <Section title="How it flows">
              <ol className="space-y-2">
                {tool.flow.map((step, index) => (
                  <li key={step} className="flex gap-3 text-sm">
                    <span className="grid size-6 shrink-0 place-items-center rounded-md bg-muted text-xs font-semibold">{index + 1}</span>
                    <span className="leading-6">{step}</span>
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </div>
        <div className="min-w-0 rounded-xl border border-border bg-background p-4">
          <ToolVisual visual={tool.visual} scene={scene} />
        </div>
      </div>

      <Section title="Input">
        {tool.input.note && <p className="mb-3 text-sm text-muted-foreground">{tool.input.note}</p>}
        {tool.input.rows.length > 0 ? (
          <Table head={["Name", "Type", "Required", "Default", "Meaning"]} rows={tool.input.rows.map(inputRow)} />
        ) : (
          !tool.input.note && <p className="text-sm text-muted-foreground">No input.</p>
        )}
      </Section>

      {tool.details?.map((section) => (
        <Section key={section.title} title={section.title}>
          <Table head={["Item", "Meaning"]} rows={section.rows.map((row) => twoColumn(row.label, ["Item", "Meaning"], <code className="font-mono text-xs">{row.label}</code>, row.meaning))} />
        </Section>
      ))}

      <Section title="Result">
        {tool.result.note && <p className="mb-3 text-sm text-muted-foreground">{tool.result.note}</p>}
        <Table head={["Field", "Meaning"]} rows={tool.result.rows.map((row) => twoColumn(row.field, ["Field", "Meaning"], <code className="font-mono text-xs">{row.field}</code>, row.meaning))} />
      </Section>

      <Section title="Example">
        <div className="grid gap-4 xl:grid-cols-2">
          <RequestBlock request={tool.request} />
          <CodeBlock label="Result" text={JSON.stringify(exampleResponse(tool, scene), null, 2)} />
        </div>
        {tool.verify === "live" && (
          <p className="mt-3 text-xs text-muted-foreground">The editor produces this output, so the test checks its shape rather than its values.</p>
        )}
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Tips">
          <ul className="space-y-2 text-sm leading-6">
            {tool.tips.map((tip) => <li key={tip} className="flex gap-2"><span aria-hidden className="text-success">✓</span><span>{tip}</span></li>)}
          </ul>
        </Section>
        <Section title="Limits">
          <ul className="space-y-2 text-sm leading-6">
            {tool.limits.map((limit) => <li key={limit} className="flex gap-2"><span aria-hidden className="text-brand">!</span><span>{limit}</span></li>)}
          </ul>
        </Section>
      </div>

      {tool.errors && tool.errors.length > 0 && (
        <Section title="Errors you may see">
          <Table head={["Message", "Cause"]} rows={tool.errors.map((error) => twoColumn(error.message, ["Message", "Cause"], <span className="font-mono text-xs">{error.message}</span>, error.cause))} />
        </Section>
      )}

      <footer className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>Related:</span>
          {tool.related.map((name) => (
            <Button key={name} variant="outline" size="sm" className="h-7 font-mono text-xs" onClick={() => onOpenTool(name)}>
              {name}
            </Button>
          ))}
        </div>
        <code className="text-xs text-muted-foreground">{tool.source}</code>
      </footer>
    </article>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="mt-6 min-w-0">
      <h4 className="mb-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

interface TableCell {
  readonly header: string;
  readonly content: ReactNode;
}

interface TableRow {
  readonly key: string;
  readonly cells: readonly TableCell[];
}

function Table({ head, rows }: { readonly head: readonly string[]; readonly rows: readonly TableRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead className="bg-muted text-xs text-muted-foreground">
          <tr>
            {head.map((label) => <th key={label} scope="col" className="px-3 py-2 font-medium">{label}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.key} className="align-top">
              {row.cells.map((cell) => <td key={cell.header} className="px-3 py-2 leading-5">{cell.content}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** A two-column row, keyed by its first column. */
function twoColumn(key: string, headers: readonly [string, string], first: ReactNode, second: ReactNode): TableRow {
  return { key, cells: [{ header: headers[0], content: first }, { header: headers[1], content: second }] };
}

function inputRow(row: AssistantToolInputRow): TableRow {
  return {
    key: row.name,
    cells: [
      { header: "Name", content: <code className="font-mono text-xs">{row.name}</code> },
      { header: "Type", content: <span className="text-xs text-muted-foreground">{row.type}</span> },
      { header: "Required", content: requiredLabel(row) },
      { header: "Default", content: row.default ? <code className="font-mono text-xs">{row.default}</code> : "–" },
      { header: "Meaning", content: row.meaning },
    ],
  };
}

function requiredLabel(row: AssistantToolInputRow): string {
  if (row.required === undefined) return "–";
  return row.required ? "Yes" : "No";
}

/** Shows a program's source as text. Other request fields follow as JSON. */
function RequestBlock({ request }: { readonly request: unknown }) {
  const source = isRecord(request) && typeof request["source"] === "string" ? request["source"] : null;
  const rest = isRecord(request) ? Object.fromEntries(Object.entries(request).filter(([key]) => key !== "source")) : request;
  const hasRest = !isRecord(rest) || Object.keys(rest).length > 0;
  return (
    <div className="min-w-0 space-y-3">
      {source !== null && <CodeBlock label="Program" text={source} />}
      {(source === null || hasRest) && <CodeBlock label={source === null ? "Request" : "Other request fields"} text={JSON.stringify(rest, null, 2)} />}
    </div>
  );
}
