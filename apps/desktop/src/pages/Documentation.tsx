import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BookOpen, Keyboard, MousePointerClick, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { useAppDispatch } from "@/app/hooks";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  assistantToolDocument,
  filterShortcutGroups,
  isSearchShortcut,
  matchesTool,
  setShortcutsOpen,
  shortcutGroups,
  toolGuide,
  type ExampleId,
} from "@/features/documentation";
import { AssistantToolsPanel, KeyCombo, ShortcutFinder, ShortcutReference, ToolGuideCard, toolCardId } from "@/features/documentation/components";
import { isTypingTarget } from "@/lib/dom";

type Area = "workspace" | "shortcuts" | "assistant";

const AREAS: readonly Area[] = ["workspace", "shortcuts", "assistant"];

const PLACEHOLDER: Readonly<Record<Area, string>> = {
  workspace: "Search tools and shortcuts…",
  shortcuts: "Search actions or keys, such as bevel or Ctrl+B…",
  assistant: "Search assistant tools, fields and limits…",
};

/** One entry per interactive example, so they can be found without reading the whole guide. */
const EXAMPLE_LINKS: readonly { example: ExampleId; label: string }[] = [
  { example: "navigation", label: "Orbit, zoom and views" },
  { example: "transform", label: "G, R and S transforms" },
  { example: "selection", label: "Click and box selection" },
];

function areaOf(value: string | null): Area {
  return AREAS.find((area) => area === value) ?? "workspace";
}

function scrollToId(id: string): void {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/** The first guide entry with this example, which is where the example's link goes. */
function firstToolWith(example: ExampleId): string | undefined {
  return toolGuide.flatMap((section) => section.tools).find((tool) => tool.example === example)?.id;
}

export default function Documentation() {
  const dispatch = useAppDispatch();
  const [query, setQuery] = useState("");
  const [params, setParams] = useSearchParams();
  const [openExamples, setOpenExamples] = useState<ReadonlySet<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const area = areaOf(params.get("area"));
  // On the workspace tab, `tool` names a guide entry to show with its example open; the assistant tab has its own.
  const linkedTool = area === "workspace" ? params.get("tool") : null;
  const term = query.trim().toLowerCase();

  // "/" moves to the search field, as on many documentation sites.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isSearchShortcut(event, isTypingTarget(event.target))) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // A link to a tool clears the search, so the tool is shown, and opens its example. This adjusts state while
  // rendering, when the link changes, rather than in an effect, so the page renders once.
  const [shownTool, setShownTool] = useState<string | null>(null);
  if (linkedTool !== shownTool) {
    setShownTool(linkedTool);
    if (linkedTool) {
      setQuery("");
      setOpenExamples((previous) => new Set(previous).add(linkedTool));
    }
  }
  // Scrolling to it waits for the card to be on the page.
  useEffect(() => {
    if (!linkedTool) return undefined;
    const frame = requestAnimationFrame(() => scrollToId(toolCardId(linkedTool)));
    return () => cancelAnimationFrame(frame);
  }, [linkedTool]);

  const sections = useMemo(() => {
    if (!term) return toolGuide;
    return toolGuide.map((section) => ({
      ...section,
      tools: section.tools.filter((tool) =>
        [section.title, section.description, tool.name, tool.shortcut, tool.description, tool.note, ...tool.steps]
          .some((text) => text?.toLowerCase().includes(term)),
      ),
    })).filter((section) => section.tools.length > 0);
  }, [term]);
  const counts: Readonly<Record<Area, number>> = useMemo(() => ({
    workspace: sections.reduce((total, section) => total + section.tools.length, 0),
    shortcuts: filterShortcutGroups(shortcutGroups, query, undefined).reduce((total, group) => total + group.controls.length, 0),
    assistant: assistantToolDocument.tools.filter((tool) => !term || matchesTool(tool, term)).length,
  }), [sections, query, term]);
  const count = counts[area];
  const noun = area === "shortcuts" ? (count === 1 ? "control" : "controls") : (count === 1 ? "tool" : "tools");

  const selectArea = (value: string) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value === "workspace") next.delete("area");
      else next.set("area", value);
      next.delete("tool");
      return next;
    }, { replace: true });
  };

  const setExampleOpen = (toolId: string, open: boolean) => {
    setOpenExamples((previous) => {
      const next = new Set(previous);
      if (open) next.add(toolId);
      else next.delete(toolId);
      return next;
    });
  };

  const openExample = (example: ExampleId) => {
    const toolId = firstToolWith(example);
    if (!toolId) return;
    setQuery("");
    setExampleOpen(toolId, true);
    requestAnimationFrame(() => scrollToId(toolCardId(toolId)));
  };

  return (
    <main className="min-h-full bg-background px-5 pb-20 pt-8 text-foreground sm:px-10 sm:pt-12">
      <div className="mx-auto max-w-5xl">
        <Link to="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 mb-8 gap-2 text-muted-foreground")}><ArrowLeft className="size-4" /> Home</Link>
        <header className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex size-10 items-center justify-center rounded-xl border border-brand/30 bg-brand/10 text-brand"><BookOpen className="size-5" /></div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Tool documentation</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Learn what each workspace tool does and try the basics in live examples, look up any key, and see what each assistant tool needs, returns and checks.
            </p>
          </div>
          <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => dispatch(setShortcutsOpen(true))}>
            <Keyboard aria-hidden className="size-3.5" /> Keyboard shortcuts <KeyCombo keys="?" />
          </Button>
        </header>

        <div className="relative mt-7 max-w-xl">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            aria-label="Search documentation"
            aria-keyshortcuts="/"
            placeholder={PLACEHOLDER[area]}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }}
            className="h-10 bg-card pr-10 pl-10"
          />
          <KeyCombo keys="/" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2" />
        </div>
        <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">{count} {noun} {term ? "found" : "in this guide"}</p>

        <Tabs value={area} onValueChange={selectArea} className="mt-8">
          <TabsList aria-label="Documentation areas" className="h-10">
            <TabsTrigger value="workspace" className="h-8 px-4">Workspace tools</TabsTrigger>
            <TabsTrigger value="shortcuts" className="h-8 px-4">Shortcuts</TabsTrigger>
            <TabsTrigger value="assistant" className="h-8 px-4">Assistant tools</TabsTrigger>
          </TabsList>

          <TabsContent value="workspace">
            <div className="grid items-start gap-10 md:grid-cols-[190px_minmax(0,1fr)]">
              <nav aria-label="Documentation sections" className="flex flex-wrap gap-2 md:sticky md:top-6 md:flex-col md:gap-1">
                {sections.map((section) => (
                  <Button key={section.id} variant="ghost" size="sm" className="h-auto justify-start px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => scrollToId(`docs-${section.id}`)}>
                    {section.title}
                  </Button>
                ))}
              </nav>
              <div className="min-w-0 space-y-12">
                {!term && (
                  <section aria-labelledby="docs-examples-heading" className="rounded-xl border border-border bg-card p-5 sm:p-6">
                    <h2 id="docs-examples-heading" className="flex items-center gap-2 text-sm font-semibold">
                      <MousePointerClick aria-hidden className="size-4 text-muted-foreground" /> Try it yourself
                    </h2>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      Live examples of the basics. Click one, then use the same keys as in the workspace. They never change your projects.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {EXAMPLE_LINKS.map(({ example, label }) => (
                        <Button key={example} type="button" variant="secondary" size="sm" onClick={() => openExample(example)}>{label}</Button>
                      ))}
                    </div>
                  </section>
                )}
                {sections.length === 0 && <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">No matching tools. Try a different name, shortcut, or task.</p>}
                {sections.map((section) => (
                  <section key={section.id} id={`docs-${section.id}`} className="scroll-mt-6" aria-labelledby={`docs-heading-${section.id}`}>
                    <h2 id={`docs-heading-${section.id}`} className="text-xl font-semibold tracking-tight">{section.title}</h2>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{section.description}</p>
                    <div className="mt-4 space-y-3">
                      {section.tools.map((tool) => (
                        <ToolGuideCard
                          key={tool.id}
                          tool={tool}
                          exampleOpen={openExamples.has(tool.id)}
                          onExampleOpenChange={(open) => setExampleOpen(tool.id, open)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="shortcuts" className="space-y-8">
            <ShortcutFinder />
            <ShortcutReference query={query} hideHeading />
          </TabsContent>

          <TabsContent value="assistant">
            <AssistantToolsPanel query={query} />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
