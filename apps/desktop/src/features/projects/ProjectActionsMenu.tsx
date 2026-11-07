import { useRef, type ReactNode } from "react";
import {
  Archive,
  ArchiveRestore,
  Copy,
  FolderOpen,
  Pencil,
  Star,
  StarOff,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Project, ProjectActionHandler } from "./projectTypes";

interface ProjectActionsMenuProps {
  project: Project;
  onAction: ProjectActionHandler;
  /** The button that opens the menu. */
  children: ReactNode;
  align?: "start" | "end";
  /** Hide "Open" where the project is already open. */
  hideOpen?: boolean;
}

/** The controls for one project, in the same order wherever they appear. */
export function ProjectActionsMenu({
  project,
  onAction,
  children,
  align = "end",
  hideOpen = false,
}: ProjectActionsMenuProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  const choose = (action: Parameters<ProjectActionHandler>[0]) => onAction(action, project, trigger.current);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild ref={trigger}>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        sideOffset={6}
        className="z-[60] w-52 p-1.5"
        onCloseAutoFocus={(event) => {
          // Rename and delete open a dialog from the menu; focus belongs to the dialog, not the button.
          if (document.querySelector('[role="dialog"][data-state="open"]'))
            event.preventDefault();
        }}
      >
        {!hideOpen && (
          <DropdownMenuItem onSelect={() => choose("open")}>
            <FolderOpen />
            Open
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => choose("rename")}>
          <Pencil />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => choose("star")}>
          {project.starred ? <StarOff /> : <Star />}
          {project.starred ? "Remove star" : "Add star"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => choose("duplicate")}>
          <Copy />
          Duplicate
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => choose("archive")}>
          {project.archived ? <ArchiveRestore /> : <Archive />}
          {project.archived ? "Restore" : "Archive"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem destructive onSelect={() => choose("delete")}>
          <Trash2 />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
