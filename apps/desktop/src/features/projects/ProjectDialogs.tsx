import { useState, type FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { displayName, PROJECT_NAME_MAX_LENGTH } from "./projectName";
import type { Project } from "./projectTypes";
import type { ProjectActions } from "./useProjectActions";

const buttonClass = "h-9 rounded-lg px-4 text-[13px]";

function RenameForm({ project, actions }: { project: Project; actions: ProjectActions }) {
  const [name, setName] = useState(project.name);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void actions.submitRename(name);
  }
  return (
    <DialogContent className="z-[100] w-[min(420px,calc(100vw-32px))] p-6" onCloseAutoFocus={actions.restoreFocus}>
      <DialogTitle className="pr-6 text-base font-semibold">Rename project</DialogTitle>
      <DialogDescription className="text-xs leading-5 text-muted-foreground">
        Leave the name empty to make it untitled again.
      </DialogDescription>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="project-name" className="text-xs">
            Name
          </label>
          <Input
            id="project-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={PROJECT_NAME_MAX_LENGTH}
            placeholder="Untitled project"
            className="h-10 rounded-lg bg-background px-3 text-[13px] shadow-none md:text-[13px] dark:bg-background"
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
        <output className="min-h-4 text-xs text-muted-foreground">{actions.error}</output>
        <div className="flex justify-end gap-2 border-t pt-4">
          <Button type="button" variant="ghost" onClick={actions.cancel} className={buttonClass}>
            Cancel
          </Button>
          <Button type="submit" disabled={actions.busy} className={buttonClass}>
            {actions.busy && <LoaderCircle size={14} className="animate-spin" />}
            Save
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

function DeleteConfirmation({ project, actions }: { project: Project; actions: ProjectActions }) {
  return (
    <DialogContent className="z-[100] w-[min(420px,calc(100vw-32px))] p-6" onCloseAutoFocus={actions.restoreFocus}>
      <DialogTitle className="pr-6 text-base font-semibold">Delete “{displayName(project)}”?</DialogTitle>
      <DialogDescription className="text-xs leading-5 text-muted-foreground">
        This permanently removes the project, its conversation and its 3D scene. You can archive it instead to keep it
        out of the way.
      </DialogDescription>
      <output className="min-h-4 text-xs text-muted-foreground">{actions.error}</output>
      <div className="flex justify-end gap-2 border-t pt-4">
        <Button type="button" variant="ghost" onClick={actions.cancel} className={buttonClass}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={actions.busy}
          onClick={() => void actions.confirmDelete()}
          className={buttonClass}
        >
          {actions.busy && <LoaderCircle size={14} className="animate-spin" />}
          Delete project
        </Button>
      </div>
    </DialogContent>
  );
}

/** The dialogs behind the rename and delete actions. Render once per page that uses the actions. */
export function ProjectDialogs({ actions }: { actions: ProjectActions }) {
  return (
    <>
      <Dialog
        open={actions.renaming !== null}
        onOpenChange={(open) => {
          if (!open) actions.cancel();
        }}
      >
        {actions.renaming && <RenameForm key={actions.renaming.id} project={actions.renaming} actions={actions} />}
      </Dialog>
      <Dialog
        open={actions.deleting !== null}
        onOpenChange={(open) => {
          if (!open) actions.cancel();
        }}
      >
        {actions.deleting && <DeleteConfirmation project={actions.deleting} actions={actions} />}
      </Dialog>
    </>
  );
}
