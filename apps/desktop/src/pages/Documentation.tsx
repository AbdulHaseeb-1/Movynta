import { useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { assistantToolDocument, matchesTool, toolGuide } from "@/features/documentation";
import { AssistantToolsPanel } from "@/features/documentation/components";

type Area = "workspace" | "assistant";

function scrollToSection(id: string): void {
  document.getElementById(`docs-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Documentation() {
  const [query, setQuery] = useState("");
  const [params, setParams] = useSearchParams();
  const area: Area = params.get("area") === "assistant" ? "assistant" : "workspace";
  const term = query.trim().toLowerCase();

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
  const workspaceCount = sections.reduce((total, section) => total + section.tools.length, 0);
  const assistantCount = useMemo(
    () => assistantToolDocument.tools.filter((tool) => !term || matchesTool(tool, term)).length,
    [term],
  );
  const count = area === "workspace" ? workspaceCount : assistantCount;

  const selectArea = (value: string) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value === "workspace") next.delete("area");
      else next.set("area", value);
      next.delete("tool");
      return next;
    }, { replace: true });
  };

  return (
    <main className="min-h-full bg-background px-5 pb-20 pt-8 text-foreground sm:px-10 sm:pt-12">
      <div className="mx-auto max-w-5xl">
        <Link to="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "-ml-2 mb-8 gap-2 text-muted-foreground")}><ArrowLeft className="size-4" /> Home</Link>
        <header className="max-w-2xl">
          <div className="mb-4 inline-flex size-10 items-center justify-center rounded-xl border border-brand/30 bg-brand/10 text-brand"><BookOpen className="size-5" /></div>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Tool documentation</h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Learn what each workspace tool does, and what each assistant tool needs, returns and checks. Each assistant tool has a worked example and a picture drawn from it.
          </p>
        </header>

        <div className="relative mt-7 max-w-xl">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Search documentation"
            placeholder={area === "workspace" ? "Search tools and shortcuts…" : "Search assistant tools, fields and limits…"}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-10 bg-card pl-10"
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground" aria-live="polite">{count} {count === 1 ? "tool" : "tools"} {term ? "found" : "in this guide"}</p>

        <Tabs value={area} onValueChange={selectArea} className="mt-8">
          <TabsList aria-label="Documentation areas" className="h-10">
            <TabsTrigger value="workspace" className="h-8 px-4">Workspace tools</TabsTrigger>
            <TabsTrigger value="assistant" className="h-8 px-4">Assistant tools</TabsTrigger>
          </TabsList>

          <TabsContent value="workspace">
            <div className="grid items-start gap-10 md:grid-cols-[190px_minmax(0,1fr)]">
              <nav aria-label="Documentation sections" className="flex flex-wrap gap-2 md:sticky md:top-6 md:flex-col md:gap-1">
                {sections.map((section) => (
                  <Button key={section.id} variant="ghost" size="sm" className="h-auto justify-start px-2 py-2 text-left text-xs text-muted-foreground hover:text-foreground" onClick={() => scrollToSection(section.id)}>
                    {section.title}
                  </Button>
                ))}
              </nav>
              <div className="min-w-0 space-y-12">
                {sections.length === 0 && <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">No matching tools. Try a different name, shortcut, or task.</p>}
                {sections.map((section) => (
                  <section key={section.id} id={`docs-${section.id}`} className="scroll-mt-6" aria-labelledby={`docs-heading-${section.id}`}>
                    <h2 id={`docs-heading-${section.id}`} className="text-xl font-semibold tracking-tight">{section.title}</h2>
                    <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{section.description}</p>
                    <div className="mt-4 space-y-3">
                      {section.tools.map((tool) => (
                        <Card key={tool.id} className="gap-0 border-border bg-card py-0 shadow-none">
                          <CardContent className="p-5 sm:p-6">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <h3 className="font-semibold">{tool.name}</h3>
                              {tool.shortcut && <Badge variant="secondary" className="font-normal">{tool.shortcut}</Badge>}
                            </div>
                            <p className="mt-2 text-sm leading-6 text-muted-foreground">{tool.description}</p>
                            <p className="mt-4 text-xs font-semibold">How to use</p>
                            <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-6 text-foreground/90">
                              {tool.steps.map((step) => <li key={step}>{step}</li>)}
                            </ol>
                            {tool.note && <p className="mt-4 rounded-md bg-muted px-3 py-2 text-xs leading-5 text-muted-foreground">{tool.note}</p>}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="assistant">
            <AssistantToolsPanel query={query} />
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}
