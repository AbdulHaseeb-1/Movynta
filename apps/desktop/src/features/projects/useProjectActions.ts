import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { useAppDispatch } from "@/app/hooks";
import { errorMessage } from "@/lib/backend";
import { projectPath } from "./projectCategories";
import {
  deleteProject,
  duplicateProject,
  updateProject,
} from "./projectsApi";
import { projectChanged, projectRemoved } from "./projectsSlice";
import type { Project, ProjectAction } from "./projectTypes";

export interface ProjectActionsOptions {
  /** Called with the project after it was renamed, starred, archived or duplicated. */
  onChanged?: (project: Project, action: ProjectAction) => void;
  onRemoved?: (project: Project) => void;
}

export interface ProjectActions {
  perform: (action: ProjectAction, project: Project) => void;
  /** The project whose name is being edited in the rename dialog, if any. */
  renaming: Project | null;
  /** The project waiting for delete confirmation, if any. */
  deleting: Project | null;
  busy: boolean;
  error: string;
  clearError: () => void;
  submitRename: (name: string) => Promise<void>;
  confirmDelete: () => Promise<void>;
  cancel: () => void;
}

/**
 * Everything the user can do to a project, shared by the library and the workspace. Quick actions
 * run at once; renaming and deleting open a dialog, which the caller renders from this state.
 */
export function useProjectActions(
  options: ProjectActionsOptions = {},
): ProjectActions {
  const { onChanged, onRemoved } = options;
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState<Project | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const attempt = useCallback(async (work: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await work();
      return true;
    } catch (failure) {
      setError(errorMessage(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const apply = useCallback(
    (project: Project, action: ProjectAction) => {
      dispatch(projectChanged(project));
      onChanged?.(project, action);
    },
    [dispatch, onChanged],
  );

  const perform = useCallback(
    (action: ProjectAction, project: Project) => {
      switch (action) {
        case "open":
          void navigate(projectPath(project));
          return;
        case "rename":
          setError("");
          setRenaming(project);
          return;
        case "delete":
          setError("");
          setDeleting(project);
          return;
        case "star":
          void attempt(async () =>
            apply(
              await updateProject(project.id, { starred: !project.starred }),
              action,
            ),
          );
          return;
        case "archive":
          void attempt(async () =>
            apply(
              await updateProject(project.id, { archived: !project.archived }),
              action,
            ),
          );
          return;
        case "duplicate":
          void attempt(async () =>
            apply(await duplicateProject(project.id), action),
          );
          return;
      }
    },
    [apply, attempt, navigate],
  );

  const submitRename = useCallback(
    async (name: string) => {
      if (!renaming) return;
      const target = renaming;
      const done = await attempt(async () =>
        apply(await updateProject(target.id, { name }), "rename"),
      );
      if (done) setRenaming(null);
    },
    [apply, attempt, renaming],
  );

  const confirmDelete = useCallback(async () => {
    if (!deleting) return;
    const target = deleting;
    const done = await attempt(async () => {
      await deleteProject(target.id);
      dispatch(projectRemoved(target.id));
      onRemoved?.(target);
    });
    if (done) setDeleting(null);
  }, [attempt, deleting, dispatch, onRemoved]);

  const cancel = useCallback(() => {
    setRenaming(null);
    setDeleting(null);
    setError("");
  }, []);

  return {
    perform,
    renaming,
    deleting,
    busy,
    error,
    clearError: () => setError(""),
    submitRename,
    confirmDelete,
    cancel,
  };
}
