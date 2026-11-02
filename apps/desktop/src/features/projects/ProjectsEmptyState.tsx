import { FolderOpen, SearchX } from "lucide-react";
import type { ReactNode } from "react";

interface ProjectsEmptyStateProps {
  variant: "first" | "filtered" | "starred" | "archived";
  /** What to offer next, such as starting a project or clearing the filters. */
  action?: ReactNode;
}

const COPY: Readonly<
  Record<ProjectsEmptyStateProps["variant"], { title: string; text: string }>
> = {
  first: {
    title: "Your projects will appear here",
    text: "Start with a prompt and Movynta saves your work as a project automatically.",
  },
  filtered: {
    title: "No projects match",
    text: "Try a different search or clear the filters.",
  },
  starred: {
    title: "No starred projects",
    text: "Star the projects you come back to most so they are easy to find.",
  },
  archived: {
    title: "Nothing archived",
    text: "Archive projects you are done with to keep your library tidy.",
  },
};

export function ProjectsEmptyState({ variant, action }: ProjectsEmptyStateProps) {
  const { title, text } = COPY[variant];
  const Icon = variant === "filtered" ? SearchX : FolderOpen;
  return (
    <div className="flex flex-col items-center rounded-xl bg-card/60 px-6 py-16 text-center ring-1 ring-border">
      <span className="grid size-12 place-items-center rounded-xl bg-foreground/[0.06] text-muted-foreground">
        <Icon size={22} strokeWidth={1.5} aria-hidden="true" />
      </span>
      <h2 className="mt-4 text-sm font-medium">{title}</h2>
      <p className="mt-1.5 max-w-[320px] text-xs leading-5 text-muted-foreground">
        {text}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
