import { useEffect } from "react";
import { useAppDispatch } from "@/app/hooks";
import { isTypingTarget } from "@/features/viewport3d/viewportShortcuts";
import { isHelpShortcut } from "./helpShortcut";
import { setShortcutsOpen } from "./helpSlice";

/** Opens the keyboard shortcuts dialog on "?" or F1. Mounted once for the whole app. */
export function useHelpShortcut(): void {
  const dispatch = useAppDispatch();
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A tool that is using the key, such as a transform waiting for a number, claims it first.
      if (event.defaultPrevented || !isHelpShortcut(event, isTypingTarget(event.target))) return;
      event.preventDefault();
      dispatch(setShortcutsOpen(true));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);
}
