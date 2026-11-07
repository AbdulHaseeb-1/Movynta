import { ChevronDown, MousePointerClick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ToolExample } from "../examples/ToolExample";
import type { ToolGuideEntry } from "../toolGuide";
import { KeyCombo } from "./KeyCombo";

interface ToolGuideCardProps {
  readonly tool: ToolGuideEntry;
  /** Whether the interactive example is shown. Only entries with an example have one. */
  readonly exampleOpen: boolean;
  readonly onExampleOpenChange: (open: boolean) => void;
}

/** The element id of a tool's card, for scrolling to it from a link. */
export function toolCardId(toolId: string): string {
  return `docs-tool-${toolId}`;
}

/** One workspace tool in the guide: what it does, how to use it, its keys and, where there is one, a live example. */
export function ToolGuideCard({ tool, exampleOpen, onExampleOpenChange }: ToolGuideCardProps) {
  const exampleId = `${toolCardId(tool.id)}-example`;
  return (
    <Card id={toolCardId(tool.id)} className="scroll-mt-6 gap-0 border-border bg-card py-0 shadow-none">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">{tool.name}</h3>
          {tool.shortcut && <KeyCombo keys={tool.shortcut} />}
        </div>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{tool.description}</p>
        <p className="mt-4 text-xs font-semibold">How to use</p>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-foreground/90">
          {tool.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        {tool.note && (
          <p className="mt-4 rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">{tool.note}</p>
        )}
        {tool.example && (
          <div className="mt-4">
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-expanded={exampleOpen}
              aria-controls={exampleId}
              onClick={() => onExampleOpenChange(!exampleOpen)}
              className="gap-1.5"
            >
              <MousePointerClick aria-hidden className="size-3.5" />
              {exampleOpen ? "Hide example" : "Try it"}
              <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", exampleOpen && "rotate-180")} />
            </Button>
            {exampleOpen && (
              <div id={exampleId} className="mt-3">
                <ToolExample id={tool.example} />
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
