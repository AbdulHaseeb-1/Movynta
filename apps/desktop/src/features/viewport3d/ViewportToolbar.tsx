import { useEffect, type ReactNode } from "react";
import {
  Hand,
  Maximize,
  Move3d,
  MousePointer2,
  Redo2,
  Rotate3d,
  Scale3d,
  ScanSearch,
  Trash2,
  Undo2,
  Video,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Viewport } from "./viewport";
import { presetForKey, VIEW_PRESETS } from "./viewPresets";
import { setViewportTool, type ViewportTool } from "./viewportSlice";

const ZOOM_STEP = 1.35;

const SHORTCUTS: Readonly<Record<string, ViewportTool>> = {
  v: "select",
  g: "move",
  r: "rotate",
  s: "scale",
  h: "pan",
};

export interface ToolButtonProps {
  label: string;
  /** Which side the tooltip opens on, away from the bar. */
  tooltipSide: "left" | "top";
  hint?: string;
  shortcut?: string;
  active?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

export function ToolButton({
  label,
  tooltipSide,
  hint,
  shortcut,
  active,
  destructive = false,
  disabled = false,
  onClick,
  children,
}: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={destructive ? "destructive" : active ? "default" : "ghost"}
          size="icon"
          className={cn(
            "size-7 rounded-full",
            !active && !destructive && "text-muted-foreground hover:text-foreground",
          )}
          aria-label={label}
          aria-pressed={active}
          aria-keyshortcuts={shortcut}
          onClick={onClick}
          disabled={disabled}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide}>
        {label}
        {hint && <span className="ml-2 opacity-60">{hint}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

interface ViewportToolbarProps {
  viewport: Viewport | null;
  hasSelection: boolean;
  disabled: boolean;
  onDelete: () => void;
  /** Moves the camera to show the selection ("selection", or everything when nothing is selected) or the whole scene. */
  onFrame?: (scope: "selection" | "all") => void;
  /** Steps back or forward through the saved edits of the project. */
  onUndo?: () => void;
  onRedo?: () => void;
  /** A vertical pill for the side of the view, or a horizontal one for its bottom edge. */
  orientation?: "vertical" | "horizontal";
  /** Tools of other features, shown in a group of their own after Select, Move, Rotate and Scale. */
  children?: ReactNode;
  className?: string;
}

/**
 * Floating bar for working in the 3D space: choosing and transforming objects (Select, Move, Rotate,
 * Scale), moving around (Pan, zoom, reset). The shortcuts follow Blender: G, R and S.
 */
export function ViewportToolbar({
  viewport,
  hasSelection,
  disabled,
  onDelete,
  onFrame,
  onUndo,
  onRedo,
  orientation = "vertical",
  children,
  className,
}: ViewportToolbarProps) {
  const horizontal = orientation === "horizontal";
  const tooltipSide = horizontal ? "top" : "left";
  const dispatch = useAppDispatch();
  const tool = useAppSelector((state) => state.viewport.tool);

  useEffect(() => {
    // Every tool but Pan leaves a drag to the camera; the transform tools add handles on the selection.
    viewport?.setNavigationTool(tool === "pan" ? "pan" : "select");
  }, [viewport, tool]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      // Numpad 1, 3 and 7 look from the front, right and top; with Ctrl, from the back, left and bottom.
      const preset = event.defaultPrevented || event.repeat || typing || event.altKey || event.metaKey ? undefined : presetForKey(event.code, event.ctrlKey);
      if (preset) {
        event.preventDefault();
        viewport?.setView(preset);
        return;
      }
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)))
      )
        return;
      const key = event.key.toLowerCase();
      const next = SHORTCUTS[key];
      if (next) {
        dispatch(setViewportTool(next));
      } else if (key === "=" || event.key === "+") {
        viewport?.zoomBy(ZOOM_STEP);
      } else if (key === "-" || key === "_") {
        viewport?.zoomBy(1 / ZOOM_STEP);
      } else if (key === "0") {
        viewport?.resetView();
      } else if (key === "." && onFrame) {
        onFrame("selection");
      } else if (event.key === "Home" && onFrame) {
        onFrame("all");
      } else if ((event.key === "Delete" || key === "x") && hasSelection) {
        event.preventDefault();
        if (!disabled) onDelete();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dispatch, viewport, hasSelection, disabled, onDelete, onFrame]);

  return (
    <TooltipProvider delayDuration={200}>
      <div
        role="toolbar"
        aria-label="Viewport tools"
        aria-orientation={orientation}
        className={cn(
          "pointer-events-auto flex items-center gap-0.5 rounded-full bg-black/60 p-1 shadow-2xl backdrop-blur-2xl backdrop-saturate-150",
          horizontal ? "flex-row" : "flex-col",
          className,
        )}
      >
        <ToolButton
          tooltipSide={tooltipSide}
          label="Select"
          hint="V · Drag empty space to box-select; Shift adds"
          shortcut="V"
          active={tool === "select"}
          onClick={() => dispatch(setViewportTool("select"))}
        >
          <MousePointer2 className="size-[15px]" />
        </ToolButton>
        <ToolButton
          tooltipSide={tooltipSide}
          label="Move"
          hint="G"
          shortcut="G"
          active={tool === "move"}
          onClick={() => dispatch(setViewportTool("move"))}
        >
          <Move3d className="size-[15px]" />
        </ToolButton>
        <ToolButton
          tooltipSide={tooltipSide}
          label="Rotate"
          hint="R"
          shortcut="R"
          active={tool === "rotate"}
          onClick={() => dispatch(setViewportTool("rotate"))}
        >
          <Rotate3d className="size-[15px]" />
        </ToolButton>
        <ToolButton
          tooltipSide={tooltipSide}
          label="Scale"
          hint="S"
          shortcut="S"
          active={tool === "scale"}
          onClick={() => dispatch(setViewportTool("scale"))}
        >
          <Scale3d className="size-[15px]" />
        </ToolButton>
        {children && (
          <>
            <Separator
              orientation={horizontal ? "vertical" : "horizontal"}
              className={cn("bg-foreground/10", horizontal ? "mx-0.5 h-[17px]" : "my-0.5 w-[17px]")}
            />
            {children}
          </>
        )}
        <Separator
          orientation={horizontal ? "vertical" : "horizontal"}
          className={cn("bg-foreground/10", horizontal ? "mx-0.5 h-[17px]" : "my-0.5 w-[17px]")}
        />
        <ToolButton
          tooltipSide={tooltipSide}
          label="Pan"
          hint="H · or hold Space"
          shortcut="H"
          active={tool === "pan"}
          onClick={() => dispatch(setViewportTool("pan"))}
        >
          <Hand className="size-[15px]" />
        </ToolButton>
        <ToolButton tooltipSide={tooltipSide} label="Zoom in" hint="= / +" shortcut="=" onClick={() => viewport?.zoomBy(ZOOM_STEP)}>
          <ZoomIn className="size-[15px]" />
        </ToolButton>
        <ToolButton
          tooltipSide={tooltipSide}
          label="Zoom out"
          hint="−"
          shortcut="-"
          onClick={() => viewport?.zoomBy(1 / ZOOM_STEP)}
        >
          <ZoomOut className="size-[15px]" />
        </ToolButton>
        {onFrame && (
          <ToolButton
            tooltipSide={tooltipSide}
            label="Frame selected"
            hint=". · Home frames everything"
            shortcut=". Home"
            onClick={() => onFrame("selection")}
          >
            <ScanSearch className="size-[15px]" />
          </ToolButton>
        )}
        <DropdownMenu modal={false}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="size-7 rounded-full text-muted-foreground hover:text-foreground" aria-label="View from">
                  <Video className="size-[15px]" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide}>
              View from
              <span className="ml-2 opacity-60">Numpad 1 · 3 · 7, with Ctrl for the other side</span>
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent side={horizontal ? "top" : "left"} sideOffset={8} className="z-[60] w-44 p-1.5">
            {VIEW_PRESETS.map((preset) => (
              <DropdownMenuItem key={preset.id} onSelect={() => viewport?.setView(preset)}>
                {preset.label}
                {preset.code && (
                  <span className="ml-auto text-[10px] opacity-60">
                    {preset.withCtrl ? "Ctrl+" : ""}Num {preset.code.slice(-1)}
                  </span>
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <ToolButton tooltipSide={tooltipSide} label="Reset view" hint="0" shortcut="0" onClick={() => viewport?.resetView()}>
          <Maximize className="size-[15px]" />
        </ToolButton>
        <Separator
          orientation={horizontal ? "vertical" : "horizontal"}
          className={cn("bg-foreground/10", horizontal ? "mx-0.5 h-[17px]" : "my-0.5 w-[17px]")}
        />
        {onUndo && (
          <ToolButton tooltipSide={tooltipSide} label="Undo" hint="Ctrl+Z" shortcut="Control+Z" disabled={disabled} onClick={onUndo}>
            <Undo2 className="size-[15px]" />
          </ToolButton>
        )}
        {onRedo && (
          <ToolButton tooltipSide={tooltipSide} label="Redo" hint="Ctrl+Shift+Z · Ctrl+Y" shortcut="Control+Shift+Z Control+Y" disabled={disabled} onClick={onRedo}>
            <Redo2 className="size-[15px]" />
          </ToolButton>
        )}
        <ToolButton
          tooltipSide={tooltipSide}
          label="Delete selected object"
          hint="Delete or X"
          shortcut="Delete X"
          disabled={!hasSelection || disabled}
          onClick={onDelete}
        >
          <Trash2 className="size-[15px]" />
        </ToolButton>
      </div>
    </TooltipProvider>
  );
}
