import { Archive, ArrowLeft, ChevronDown, Star, X } from "lucide-react";
import { Link } from "react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProjectActionsMenu } from "./ProjectActionsMenu";
import { ProjectTitle } from "./ProjectTitle";
import type { Project, ProjectActionHandler } from "./projectTypes";

interface ProjectBarProps {
  /** Undefined while the workspace is blank: the project is created on the first prompt. */
  project: Project | undefined;
  onAction: ProjectActionHandler;
  onRename: (project: Project, name: string) => Promise<void>;
  /** Why the last action (star, archive, duplicate) failed. Shown under the bar until it is dismissed. */
  error?: string;
  onDismissError?: () => void;
  className?: string;
}

const surface =
  "bg-black/60 shadow-2xl backdrop-blur-2xl backdrop-saturate-150";

/** The strip over the workspace: a way back, the project's name, and its controls. */
export function ProjectBar({
  project,
  onAction,
  onRename,
  error = "",
  onDismissError,
  className,
}: ProjectBarProps) {
  return (
    <div className={cn("relative flex items-center gap-1.5", className)}>
      {error && (
        <div
          role="alert"
          className="absolute top-full left-0 mt-2 flex max-w-[min(420px,calc(100vw-32px))] items-center gap-2 rounded-lg bg-popover px-3 py-2 text-xs text-destructive shadow-xl"
        >
          <span>{error}</span>
          {onDismissError && (
            <button
              type="button"
              onClick={onDismissError}
              aria-label="Dismiss error"
              className="shrink-0 rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
      <Link
        to="/"
        aria-label="Back to home"
        title="Back to home"
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "size-8 rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground",
          surface,
        )}
      >
        <ArrowLeft className="size-4" />
      </Link>
      <div
        className={cn("flex h-8 items-center gap-1 rounded-full pr-1 pl-2", surface)}
      >
        {project ? (
          <>
            <ProjectTitle
              name={project.name}
              onRename={(name) => onRename(project, name)}
            />
            {project.starred && (
              <Star
                className="size-3.5 shrink-0 fill-current text-foreground"
                aria-label="Starred"
              />
            )}
            {project.archived && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-foreground/10 px-2 py-1 text-[11px] leading-none text-muted-foreground">
                <Archive className="size-3" aria-hidden="true" />
                Archived
              </span>
            )}
            <ProjectActionsMenu
              project={project}
              onAction={onAction}
              align="start"
              hideOpen
            >
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Project actions"
                className="size-7 rounded-full text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
              >
                <ChevronDown className="size-4" />
              </Button>
            </ProjectActionsMenu>
          </>
        ) : (
          <>
            <ProjectTitle name="" readOnly onRename={() => Promise.resolve()} />
            <span className="mr-2 text-[11px] text-muted-foreground/80">
              Saved with your first prompt
            </span>
          </>
        )}
      </div>
    </div>
  );
}
