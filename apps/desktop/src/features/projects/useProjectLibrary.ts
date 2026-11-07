import { useCallback, useEffect, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { errorMessage } from "@/lib/backend";
import { listProjects } from "./projectsApi";
import { projectsFailed, projectsLoaded, projectsLoading } from "./projectsSlice";
import type { ProjectFilters } from "./projectTypes";

/**
 * The projects matching `filters`, kept in the store. It loads when the filters change or the backend
 * connects, and `reload` refreshes after a change. An older answer never replaces a newer one.
 */
export function useProjectLibrary(filters: ProjectFilters) {
  const dispatch = useAppDispatch();
  const { items, status, error } = useAppSelector((state) => state.projects);
  const connected = useAppSelector((state) => state.providers.connected);
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    dispatch(projectsLoading());
    try {
      const projects = await listProjects(filters);
      if (request === latest.current) dispatch(projectsLoaded(projects));
    } catch (failure) {
      if (request === latest.current) dispatch(projectsFailed(errorMessage(failure)));
    }
  }, [dispatch, filters]);

  useEffect(() => {
    if (connected) void reload();
  }, [connected, reload]);

  return { projects: items, status, error, connected, reload };
}
