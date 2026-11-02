import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { projectCategories } from "./projectCategories";
import type {
  ProjectFilters,
  ProjectSort,
  ProjectView,
} from "./projectTypes";

const VIEWS: readonly { id: ProjectView; label: string }[] = [
  { id: "all", label: "All" },
  { id: "starred", label: "Starred" },
  { id: "archived", label: "Archived" },
];

const SORTS: readonly { id: ProjectSort; label: string }[] = [
  { id: "updated", label: "Last updated" },
  { id: "created", label: "Recently created" },
  { id: "name", label: "Name" },
];

interface ProjectsToolbarProps {
  /** The text in the search box, which may be ahead of the filters while the user is typing. */
  search: string;
  onSearchChange: (search: string) => void;
  filters: ProjectFilters;
  onFiltersChange: (filters: ProjectFilters) => void;
}

const selectTriggerClass =
  "h-9 w-[160px] rounded-lg bg-card text-[13px] shadow-none";

export function ProjectsToolbar({
  search,
  onSearchChange,
  filters,
  onFiltersChange,
}: ProjectsToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-[220px] flex-1 basis-64">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search projects"
          aria-label="Search projects"
          maxLength={100}
          className="h-9 rounded-lg border-transparent bg-card pr-9 pl-9 text-[13px] shadow-none md:text-[13px] dark:bg-card [&::-webkit-search-cancel-button]:hidden"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange("")}
            aria-label="Clear search"
            className="absolute top-1/2 right-2.5 grid size-5 -translate-y-1/2 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>
      <div
        role="tablist"
        aria-label="Project view"
        className="flex h-9 items-center rounded-lg bg-card p-0.5"
      >
        {VIEWS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={filters.view === id}
            onClick={() => onFiltersChange({ ...filters, view: id })}
            className={cn(
              "h-8 rounded-md px-3.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
              filters.view === id && "bg-accent font-medium text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <Select
        value={filters.category}
        onValueChange={(category) => {
          const match = projectCategories.find((item) => item.id === category);
          onFiltersChange({ ...filters, category: match ? match.id : "all" });
        }}
      >
        <SelectTrigger aria-label="Category" className={selectTriggerClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All categories</SelectItem>
          {projectCategories.map((category) => (
            <SelectItem key={category.id} value={category.id}>
              {category.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.sort}
        onValueChange={(sort) => {
          const match = SORTS.find((item) => item.id === sort);
          if (match) onFiltersChange({ ...filters, sort: match.id });
        }}
      >
        <SelectTrigger aria-label="Sort by" className={selectTriggerClass}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SORTS.map((sort) => (
            <SelectItem key={sort.id} value={sort.id}>
              {sort.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
