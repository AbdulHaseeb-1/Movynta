import { useEffect, useState } from "react";
import { ArrowRight, Folder, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { libraryToggleVisible } from "./libraryToggle";
import { NewProjectButton } from "./NewProjectButton";
import { ProjectCard } from "./ProjectCard";
import { ProjectDialogs } from "./ProjectDialogs";
import { ProjectsEmptyState } from "./ProjectsEmptyState";
import { ProjectsToolbar } from "./ProjectsToolbar";
import { defaultProjectFilters, type ProjectFilters } from "./projectTypes";
import { useProjectActions } from "./useProjectActions";
import { useProjectLibrary } from "./useProjectLibrary";

const COLLAPSED_COUNT = 3;
const SEARCH_DELAY_MS = 250;
const SKELETON_COUNT = 4;
const GRID = "grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4";

/** The last tile of the grid: a way to start something new from where the projects are. */
function NewProjectTile() {
  return (
    <NewProjectButton
      variant="ghost"
      className="group h-auto min-h-[156px] flex-col gap-3 rounded-xl bg-card/60 p-4 text-[13px] font-medium text-muted-foreground ring-1 ring-border transition-[transform,box-shadow] hover:-translate-y-0.5 hover:bg-card hover:text-foreground hover:ring-foreground/25 motion-reduce:hover:translate-y-0"
    >
      <span className="grid size-10 place-items-center rounded-full bg-foreground/10 text-foreground">
        <Plus className="size-5" aria-hidden="true" />
      </span>
      New project
    </NewProjectButton>
  );
}

/**
 * The projects on the home page: the latest few, and a "View all" that opens the whole library
 * in place, with search, views, category and sorting.
 */
export function ProjectsSection() {
  const [expanded, setExpanded] = useState(false);
  const [filters, setFilters] = useState<ProjectFilters>(defaultProjectFilters);
  const [search, setSearch] = useState("");
  // The short row always shows the latest projects, whatever the library was last filtered to.
  const { projects, status, error, connected, reload } = useProjectLibrary(
    expanded ? filters : defaultProjectFilters,
  );
  const actions = useProjectActions({
    onChanged: () => void reload(),
    onRemoved: () => void reload(),
  });

  // Search as the user types, but ask the backend only once they pause.
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setFilters((current) =>
          current.search === search ? current : { ...current, search },
        ),
      SEARCH_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [search]);

  const filtered = filters.search !== "" || filters.category !== "all";
  const loading = status === "loading" || status === "idle";
  const visible = expanded ? projects : projects.slice(0, COLLAPSED_COUNT);
  const notice =
    actions.renaming || actions.deleting ? "" : actions.error || error || "";

  function clearFilters() {
    setSearch("");
    setFilters(defaultProjectFilters);
  }

  function emptyVariant() {
    if (filtered) return "filtered" as const;
    if (filters.view === "starred") return "starred" as const;
    if (filters.view === "archived") return "archived" as const;
    return "first" as const;
  }

  return (
    <section
      aria-labelledby="projects-heading"
      className="col-span-full flex flex-col gap-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="projects-heading"
          className="flex items-center gap-3 text-[17px] font-semibold tracking-[-0.02em]"
        >
          <Folder className="size-5 text-muted-foreground" aria-hidden="true" />
          Projects
        </h2>
        {libraryToggleVisible(connected, status) && (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            className="inline-flex items-center gap-1.5 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            {expanded ? "Show less" : "View all"}
            <ArrowRight
              className={cn("size-3.5 transition-transform", expanded && "-rotate-90")}
              aria-hidden="true"
            />
          </button>
        )}
      </div>

      {expanded && (
        <ProjectsToolbar
          search={search}
          onSearchChange={setSearch}
          filters={filters}
          onFiltersChange={setFilters}
        />
      )}

      {notice && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-lg bg-destructive/10 px-4 py-2.5 text-xs text-destructive"
        >
          <span>{notice}</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              actions.clearError();
              void reload();
            }}
            className="h-7 text-xs text-destructive hover:text-destructive"
          >
            Retry
          </Button>
        </div>
      )}

      {!connected ? (
        <p className="text-xs text-muted-foreground">
          Waiting for your local backend. Your projects appear once it connects.
        </p>
      ) : loading && projects.length === 0 ? (
        <div className={GRID} aria-busy="true" aria-label="Loading projects">
          {Array.from({ length: SKELETON_COUNT }, (_, index) => (
            <div
              key={index}
              className="h-[156px] animate-pulse rounded-xl bg-card ring-1 ring-border motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : projects.length === 0 && expanded ? (
        <ProjectsEmptyState
          variant={emptyVariant()}
          action={
            filtered ? (
              <Button
                type="button"
                variant="outline"
                onClick={clearFilters}
                className="h-9 rounded-lg px-4 text-[13px]"
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className={cn(GRID, "transition-opacity", loading && "opacity-60")}>
          {visible.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onAction={actions.perform}
            />
          ))}
          <NewProjectTile />
        </div>
      )}
      <ProjectDialogs actions={actions} />
    </section>
  );
}
