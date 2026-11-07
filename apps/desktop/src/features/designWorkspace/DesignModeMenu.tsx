import { Box, ChevronDown, MousePointer2, PencilRuler } from "lucide-react";
import { isShortcutBlocked } from "@/lib/dom";
import { useEffect, useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { setDesignMode } from "./workspaceSlice";
import { knifeIsActive } from "./knifeActivity";
import { extrudeIsActive } from "@/features/objectEditing/ExtrudeGesture";

/** The menu that switches between Object and Edit mode, showing the shortcut for each. */
export function DesignModeMenu() {
  const dispatch = useAppDispatch();
  const mode = useAppSelector((state) => state.designWorkspace.mode);
  const [menuOpen, setMenuOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const suppressTooltip = useRef(false);
  const menuIsOpen = useRef(false);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        menuOpen ||
        knifeIsActive() ||
        extrudeIsActive() ||
        isShortcutBlocked(event.target)
      )
        return;
      const key = event.key.toLowerCase();
      if ((mode === "object" && key === "e") || (mode === "edit" && key === "o")) {
        event.preventDefault();
        dispatch(setDesignMode(mode === "object" ? "edit" : "object"));
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [dispatch, mode, menuOpen]);
  return (
    <TooltipProvider>
      <DropdownMenu
        open={menuOpen}
        onOpenChange={(open) => {
          menuIsOpen.current = open;
          if (open) suppressTooltip.current = true;
          setMenuOpen(open);
          setTooltipOpen(false);
        }}
      >
        <Tooltip
          open={tooltipOpen && !menuOpen}
          onOpenChange={(open) => setTooltipOpen(open && !suppressTooltip.current)}
        >
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-8 gap-1.5 rounded-full border border-border bg-card px-3 text-xs text-card-foreground shadow-xl hover:bg-accent data-[state=open]:bg-accent"
                aria-label={`Design mode: ${mode === "object" ? "Object" : "Edit"}`}
                onPointerEnter={() => {
                  if (!menuIsOpen.current) suppressTooltip.current = false;
                }}
                onBlur={() => {
                  if (!menuIsOpen.current) suppressTooltip.current = false;
                }}
              >
                <Box className="size-3.5 text-foreground" />
                {mode === "object" ? "Object" : "Edit"}
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            {mode === "object" ? "Select and transform whole objects" : "Select mesh vertices, edges or faces"}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="start" className="w-44 border border-border bg-popover p-1 shadow-xl">
          <DropdownMenuRadioGroup
            value={mode}
            onValueChange={(value) => {
              if (value === "object" || value === "edit") dispatch(setDesignMode(value));
            }}
          >
            <DropdownMenuRadioItem
              value="object"
              className="min-h-9 flex-row items-center justify-start px-3 pr-8 text-muted-foreground data-[state=checked]:bg-secondary data-[state=checked]:text-foreground focus:bg-accent focus:text-foreground"
            >
              <span className="inline-flex items-center gap-2 leading-none">
                <MousePointer2 className="size-4" /> Object · O
              </span>
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="edit"
              className="min-h-9 flex-row items-center justify-start px-3 pr-8 text-muted-foreground data-[state=checked]:bg-secondary data-[state=checked]:text-foreground focus:bg-accent focus:text-foreground"
            >
              <span className="inline-flex items-center gap-2 leading-none">
                <PencilRuler className="size-4" /> Edit · E{" "}
              </span>
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
