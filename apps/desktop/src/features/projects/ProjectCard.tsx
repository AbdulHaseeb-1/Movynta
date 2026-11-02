import { Archive, MoreHorizontal, Star } from "lucide-react";
import { Link } from "react-router";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "./formatRelativeTime";
import { ProjectActionsMenu } from "./ProjectActionsMenu";
import { projectPath } from "./projectCategories";
import { displayName, isUntitled } from "./projectName";
import { ProjectThumbnail } from "./ProjectThumbnail";
import type { Project, ProjectAction } from "./projectTypes";

interface ProjectCardProps {
  project: Project;
  onAction: (action: ProjectAction, project: Project) => void;
}

/**
 * One project on the home page. The whole card opens the project; the star and the menu sit above
 * that link so they work on their own.
 */
export function ProjectCard({ project, onAction }: ProjectCardProps) {
  const title = displayName(project);
  const untitled = isUntitled(project);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl bg-card ring-1 ring-border transition-[transform,box-shadow] duration-200 focus-within:ring-ring hover:-translate-y-0.5 hover:ring-foreground/25 motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      <Link
        to={projectPath(project)}
        aria-label={`Open ${title}`}
        title={project.firstPrompt || undefined}
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none"
      />
      <ProjectThumbnail />
      {project.archived && (
        <span className="pointer-events-none absolute top-3 left-3 inline-flex items-center gap-1 rounded-full bg-background/80 px-2 py-1 text-[11px] leading-none text-muted-foreground backdrop-blur">
          <Archive className="size-3" aria-hidden="true" />
          Archived
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={project.starred ? "Remove star" : "Add star"}
        aria-pressed={project.starred}
        onClick={() => onAction("star", project)}
        className={cn(
          "absolute top-2.5 right-2.5 z-10 rounded-full text-muted-foreground transition-opacity hover:bg-transparent hover:text-foreground focus-visible:bg-transparent focus-visible:opacity-100",
          project.starred
            ? "text-foreground"
            : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
        )}
      >
        <Star className={cn("size-3.5", project.starred && "fill-current")} />
      </Button>
      <div className="pointer-events-none relative flex items-end justify-between gap-2 p-3.5 pt-3">
        <div className="min-w-0">
          <h3
            title={title}
            className={cn(
              "truncate text-sm leading-5 font-semibold",
              untitled && "font-medium text-muted-foreground",
            )}
          >
            {title}
          </h3>
          <p className="mt-0.5 truncate text-xs leading-4 text-muted-foreground">
            <time dateTime={project.updatedAt}>
              Updated {formatRelativeTime(project.updatedAt)}
            </time>
          </p>
        </div>
        <ProjectActionsMenu project={project} onAction={onAction}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${title}`}
            className="pointer-events-auto relative z-10 -mr-1 shrink-0 rounded-full bg-foreground/[0.06] text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </ProjectActionsMenu>
      </div>
    </article>
  );
}
