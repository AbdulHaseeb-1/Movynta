import { useEffect } from "react";
import { useSearchParams } from "react-router";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { assistantToolDocument, matchesTool, toolAnchor, toolsOfType } from "../assistantTools/assistantTools";
import {
  assistantToolTypeSchema,
  type AssistantTool,
  type AssistantToolType,
} from "../assistantTools/assistantTools.schema";
import { AssistantToolCard } from "./AssistantToolCard";

interface AssistantToolsPanelProps {
  /** The search text from the page. Empty shows everything. */
  readonly query: string;
}

const reference = assistantToolDocument;

function groupTitle(group: string): string {
  if (group === "Inspect") return "Inspect the scene";
  if (group === "Calculate") return "Calculate without changing";
  return group;
}

function scrollToTool(name: string): void {
  document.getElementById(toolAnchor(name))?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/**
 * The assistant tool reference. The tool type is kept in the URL (`type`), and a tool to open is kept too (`tool`),
 * so a link can point at a specific tool. The app uses hash routing, so ids are never used as links.
 */
export function AssistantToolsPanel({ query }: AssistantToolsPanelProps) {
  const [params, setParams] = useSearchParams();
  const requested = assistantToolTypeSchema.safeParse(params.get("type"));
  const activeType: AssistantToolType = requested.success ? requested.data : "read";
  const openName = params.get("tool");
  const term = query.trim().toLowerCase();

  useEffect(() => {
    if (openName) scrollToTool(openName);
  }, [openName]);

  const toolsFor = (type: AssistantToolType): AssistantTool[] =>
    toolsOfType(reference, type).filter((tool) => term === "" || matchesTool(tool, term));

  const selectType = (type: string) => {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("area", "assistant");
        next.set("type", type);
        next.delete("tool");
        return next;
      },
      { replace: true },
    );
  };

  const openTool = (name: string) => {
    const target = reference.tools.find((tool) => tool.name === name);
    if (!target) return;
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.set("area", "assistant");
        next.set("type", target.type);
        next.set("tool", name);
        return next;
      },
      { replace: true },
    );
  };

  return (
    <div className="space-y-6">
      <Collapsible className="rounded-xl border border-border bg-card">
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm font-medium transition-colors hover:text-brand">
          About this reference: rules and conventions
          <span aria-hidden className="text-xs text-muted-foreground">
            Show or hide
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent className="px-5 pb-5 sm:px-6 sm:pb-6">
          <p className="text-sm leading-6 text-muted-foreground">{reference.intro}</p>
          <div className="mt-5 grid gap-6 md:grid-cols-2">
            <div>
              <h2 className="text-sm font-semibold">Rules</h2>
              <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm leading-6 text-foreground/90">
                {reference.rules.map((rule) => (
                  <li key={rule}>{rule}</li>
                ))}
              </ol>
            </div>
            <div>
              <h2 className="text-sm font-semibold">Conventions</h2>
              <dl className="mt-2 space-y-2 text-sm">
                {reference.conventions.map((convention) => (
                  <div key={convention.term}>
                    <dt className="font-medium">{convention.term}</dt>
                    <dd className="leading-6 text-muted-foreground">{convention.meaning}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Tabs value={activeType} onValueChange={selectType}>
        <TabsList aria-label="Assistant tool types">
          {reference.types.map((type) => (
            <TabsTrigger key={type.id} value={type.id}>
              {type.label}
              <span className="text-xs text-muted-foreground">{toolsFor(type.id).length}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {reference.types.map((type) => {
          const tools = toolsFor(type.id);
          const groups = [...new Set(tools.map((tool) => tool.group ?? ""))];
          return (
            <TabsContent key={type.id} value={type.id} className="space-y-8">
              <p className="text-sm text-muted-foreground">{type.hint}</p>
              {tools.length === 0 && (
                <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  No {type.label.toLowerCase()} tools match “{query.trim()}”.
                </p>
              )}
              {groups.map((group) => {
                const members = tools.filter((tool) => (tool.group ?? "") === group);
                return (
                  <div key={group || "all"} className="space-y-4">
                    {group && <h2 className="text-lg font-semibold tracking-tight">{groupTitle(group)}</h2>}
                    <nav aria-label={`${type.label} tools`} className="flex flex-wrap gap-1.5">
                      {members.map((tool) => (
                        <button
                          key={tool.name}
                          type="button"
                          onClick={() => scrollToTool(tool.name)}
                          className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
                        >
                          {tool.name}
                        </button>
                      ))}
                    </nav>
                    {members.map((tool) => (
                      <AssistantToolCard
                        key={tool.name}
                        tool={tool}
                        scene={reference.scene}
                        typeLabel={type.label}
                        onOpenTool={openTool}
                      />
                    ))}
                  </div>
                );
              })}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
