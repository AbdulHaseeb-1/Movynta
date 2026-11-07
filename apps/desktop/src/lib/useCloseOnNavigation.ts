import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { createNavigationWatch } from "./navigationWatch";

/** Calls `onClose` when the user moves to another page, so a dialog never stays open over a page it was not opened on. */
export function useCloseOnNavigation(onClose: () => void): void {
  const { pathname, search } = useLocation();
  const page = `${pathname}${search}`;
  const [moved] = useState(() => createNavigationWatch(page));
  useEffect(() => {
    if (moved(page)) onClose();
  }, [moved, page, onClose]);
}
