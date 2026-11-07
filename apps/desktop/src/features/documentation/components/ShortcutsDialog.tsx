import { BookOpen, Keyboard } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, useLocation } from "react-router";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { SHORTCUTS_PATH } from "../guideLinks";
import { setShortcutsOpen } from "../shortcuts/helpSlice";
import { KeyCombo } from "./KeyCombo";
import { ShortcutReference } from "./ShortcutReference";

/** The keyboard shortcuts dialog. Mounted once for the app; "?" or F1 opens it from any page. */
export function ShortcutsDialog() {
  const open = useAppSelector((state) => state.help.shortcutsOpen);
  const dispatch = useAppDispatch();
  const close = () => dispatch(setShortcutsOpen(false));
  // Moving to another page, including with the browser's back button, closes the list.
  const { pathname, search } = useLocation();
  const page = `${pathname}${search}`;
  const shownOn = useRef(page);
  useEffect(() => {
    if (shownOn.current === page) return;
    shownOn.current = page;
    dispatch(setShortcutsOpen(false));
  }, [dispatch, page]);

  return (
    <Dialog open={open} onOpenChange={(next) => dispatch(setShortcutsOpen(next))}>
      <DialogContent className="flex h-[min(680px,calc(100vh-48px))] w-[min(880px,calc(100vw-32px))] flex-col gap-0 overflow-hidden rounded-xl p-0">
        <div className="flex h-14 shrink-0 items-center gap-2.5 border-b px-5 pr-12">
          <Keyboard className="size-4 text-muted-foreground" aria-hidden />
          <DialogTitle className="text-[15px] font-semibold">Keyboard shortcuts</DialogTitle>
          <span className="ml-auto hidden items-center gap-1.5 text-[11px] text-muted-foreground sm:inline-flex">
            Open anytime with <KeyCombo keys="? / F1" />
          </span>
        </div>
        <DialogDescription className="sr-only">
          Every keyboard, mouse and toolbar control, grouped by where it applies. Search by action or key.
        </DialogDescription>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <ShortcutReference hideHeading onNavigate={close} />
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-card px-5 py-3">
          <p className="text-[11px] text-muted-foreground">Not sure what a key does? Press it in the key finder.</p>
          <div className="flex gap-2">
            <Link to={SHORTCUTS_PATH} onClick={close} className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1.5")}>
              <Keyboard className="size-3.5" aria-hidden /> Key finder
            </Link>
            <Link to="/documentation" onClick={close} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}>
              <BookOpen className="size-3.5" aria-hidden /> Full documentation
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
