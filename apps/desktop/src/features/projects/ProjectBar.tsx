import { Archive, ArrowLeft, ChevronDown, Star } from "lucide-react";
import { Link } from "react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ProjectActionsMenu } from "./ProjectActionsMenu";
import { ProjectTitle } from "./ProjectTitle";
import type { Project, ProjectAction } from "./projectTypes";

interface ProjectBarProps {
  /** Undefined while the workspace is blank: the project is created on the first prompt. */
  project: Project | undefined;
  onAction: (action: ProjectAction, project: Project) => void;
  onRename: (project: Project, name: string) => Promise<void>;
  className?: string;
}

const surface =
  "bg-black/60 shadow-2xl backdrop-blur-2xl backdrop-saturate-150";

/** The strip over the workspace: a way back, the project's name, and its controls. */
export function ProjectBar({
  project,
  onAction,
  onRename,
  className,
}: ProjectBarProps) {
  return (
    <div className={cn("flex items-center gap-1.5", className)}>
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
