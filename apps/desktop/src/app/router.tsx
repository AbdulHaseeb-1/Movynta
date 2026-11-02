import { createHashRouter, Navigate } from "react-router";
import App from "./App";
import { Assistant, Home } from "@/pages";

// Hash routing keeps deep links working when the desktop app loads local files.
export const router = createHashRouter([
  {
    Component: App,
    children: [
      { index: true, id: "home", Component: Home },
      // One route for a new project and for an open one, so creating the project on the first prompt
      // changes the address without reloading the workspace.
      { path: "studio/:projectId?", id: "studio", Component: Assistant },
      { path: "*", element: <Navigate to="/" replace /> },
    ],
  },
]);
