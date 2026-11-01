import { useEffect, type ReactNode } from "react";
import { Hand, Maximize, MousePointer2, ZoomIn, ZoomOut } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { NavigationTool, Viewport } from "./viewport";
import { setNavigationTool } from "./viewportSlice";

const ZOOM_STEP = 1.35;

const SHORTCUTS: Readonly<Record<string, NavigationTool>> = {
  v: "select",
  h: "pan",
};

interface ToolButtonProps {
  label: string;
  hint?: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ToolButton({
  label,
  hint,
  active,
  onClick,
  children,
}: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? "default" : "ghost"}
          size="icon"
          className={cn(
            "size-10 rounded-full",
            !active && "text-muted-foreground hover:text-foreground",
          )}
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">
        {label}
        {hint && <span className="ml-2 opacity-60">{hint}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

interface ViewportToolbarProps {
  viewport: Viewport | null;
  className?: string;
}

/** Floating bar for moving around the 3D space: Select (orbit), Hand (pan), zoom and reset. */
export function ViewportToolbar({ viewport, className }: ViewportToolbarProps) {
  const dispatch = useAppDispatch();
  const tool = useAppSelector((state) => state.viewport.tool);

  useEffect(() => {
    viewport?.setNavigationTool(tool);
  }, [viewport, tool]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))
      )
        return;
      const next = SHORTCUTS[event.key.toLowerCase()];
      if (next) dispatch(setNavigationTool(next));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch]);

  return (
    <TooltipProvider delayDuration={200}>
      <div
        role="toolbar"
        aria-label="Viewport tools"
        aria-orientation="vertical"
        className={cn(
          "pointer-events-auto flex flex-col items-center gap-1 rounded-full bg-black/60 p-1.5 shadow-2xl backdrop-blur-2xl backdrop-saturate-150",
          className,
        )}
      >
        <ToolButton
          label="Select"
          hint="V"
          active={tool === "select"}
          onClick={() => dispatch(setNavigationTool("select"))}
        >
          <MousePointer2 className="size-[18px]" />
        </ToolButton>
        <ToolButton
          label="Pan"
          hint="H · or hold Space"
          active={tool === "pan"}
          onClick={() => dispatch(setNavigationTool("pan"))}
        >
          <Hand className="size-[18px]" />
        </ToolButton>
        <Separator className="my-1 w-6 bg-foreground/10" />
        <ToolButton label="Zoom in" onClick={() => viewport?.zoomBy(ZOOM_STEP)}>
          <ZoomIn className="size-[18px]" />
        </ToolButton>
        <ToolButton
          label="Zoom out"
          onClick={() => viewport?.zoomBy(1 / ZOOM_STEP)}
        >
          <ZoomOut className="size-[18px]" />
        </ToolButton>
        <ToolButton label="Reset view" onClick={() => viewport?.resetView()}>
          <Maximize className="size-[18px]" />
        </ToolButton>
      </div>
    </TooltipProvider>
  );
}
