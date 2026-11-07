import { createSlice, original, type PayloadAction } from "@reduxjs/toolkit";
import { backendDisconnected } from "@/features/providers";
import type { Project } from "./projectTypes";

export type ProjectsStatus = "idle" | "loading" | "ready" | "error";

interface ProjectsState {
  /** The projects of the last listing, in the order the backend returned them. */
  items: Project[];
  status: ProjectsStatus;
  error: string | null;
}

const initialState: ProjectsState = { items: [], status: "idle", error: null };

/**
 * Where a project is in the list. The search runs on the plain list underneath the draft: reading every
 * item through the draft would wrap each one in a proxy, which costs far more than the search itself.
 */
function indexOfProject(items: Project[], id: string): number {
  return (original(items) ?? items).findIndex((item) => item.id === id);
}

const slice = createSlice({
  name: "projects",
  initialState,
  reducers: {
    projectsLoading(state) {
      state.status = "loading";
      state.error = null;
    },
    projectsLoaded(state, action: PayloadAction<Project[]>) {
      state.items = action.payload;
      state.status = "ready";
      state.error = null;
    },
    projectsFailed(state, action: PayloadAction<string>) {
      state.status = "error";
      state.error = action.payload;
    },
    /** Replaces a project in place, so a rename or star shows before the next listing arrives. */
    projectChanged(state, action: PayloadAction<Project>) {
      const index = indexOfProject(state.items, action.payload.id);
      if (index >= 0) state.items[index] = action.payload;
    },
    projectRemoved(state, action: PayloadAction<string>) {
      const index = indexOfProject(state.items, action.payload);
      if (index >= 0) state.items.splice(index, 1);
    },
  },
  extraReducers: (builder) => {
    builder.addCase(backendDisconnected, () => initialState);
  },
});

export const { projectsLoading, projectsLoaded, projectsFailed, projectChanged, projectRemoved } = slice.actions;
export const projectsReducer = slice.reducer;
