import { BoxSelect, Grid2x2, Move, SquareDashed, Blend } from "lucide-react";
import { useRef, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import type { EditorScene } from "@/features/assistant";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { FaceTool } from "@/features/objectEditing/ExtrudeGesture";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { errorMessage, type SerialQueue } from "@/lib";
import { requestComponentSelection, setComponentError, setComponentKind } from "./workspaceSlice";
import { MeshSelectionIcon } from "./MeshSelectionIcon";
import { subdivideSelectedFaces } from "./subdivideSelection";
import { KnifeToolMenu } from "./KnifeToolMenu";
import { MeshCleanupMenu } from "./MeshCleanupMenu";

interface ComponentToolbarProps {
  scene: EditorScene | null;
  saves: SerialQueue;
  start: (tool: FaceTool) => void;
  startKnife: (onlySelected?: boolean) => void;
  disabled: boolean;
}

export function ComponentToolbar({ scene, saves, start, startKnife, disabled }: ComponentToolbarProps) {
  const dispatch = useAppDispatch();
  const [extrudeTooltip, setExtrudeTooltip] = useState(false);
  const suppressExtrudeTooltip = useRef(false);
  const extrudeMenuOpen = useRef(false);
  const { componentKind, componentError, componentSelection, knifeActive } = useAppSelector(
    (state) => state.designWorkspace,
  );
  const canSubdivide = componentKind === "face" && (componentSelection?.ids.length ?? 0) > 0;
  const selected = scene !== null && (componentSelection?.ids.length ?? 0) > 0;
  const startTool = (tool: FaceTool) => {
    dispatch(setComponentError(""));
    start(tool);
  };
  const subdivide = () => {
    if (!scene || !componentSelection) return;
    dispatch(setComponentError(""));
    subdivideSelectedFaces(scene, componentSelection, saves, (failure) => dispatch(setComponentError(errorMessage(failure))));
  };
  return (
    <div className="relative">
      <TooltipProvider>
        <fieldset
          disabled={disabled || knifeActive}
          aria-label="Mesh selection"
          className="flex min-h-8 max-w-full flex-wrap items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shadow-xl"
        >
          {(
            [
              ["vertex", "Vertices"],
              ["edge", "Edges"],
              ["face", "Faces"],
            ] as const
          ).map(([kind, label]) => (
            <Tooltip key={kind}>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant={componentKind === kind ? "secondary" : "ghost"}
                  className="size-7 rounded-sm [&_svg]:size-4"
                  aria-label={`Select ${label.toLowerCase()}`}
                  aria-pressed={componentKind === kind}
                  onClick={() => dispatch(setComponentKind(kind))}
                >
                  <MeshSelectionIcon kind={kind} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {label} · Shift-click to add or remove · drag or press B to box select
              </TooltipContent>
            </Tooltip>
          ))}
          <DropdownMenu>
            <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" className="size-7 rounded-sm" aria-label="Expand or reduce selection" disabled={!selected}><SquareDashed className="size-4" /></Button></DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem disabled={componentKind !== "edge"} onSelect={() => dispatch(requestComponentSelection("loop"))}>Select edge loop</DropdownMenuItem>
              <DropdownMenuItem disabled={componentKind !== "edge"} onSelect={() => dispatch(requestComponentSelection("ring"))}>Select edge ring</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => dispatch(requestComponentSelection("connected"))}>Select connected</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => dispatch(requestComponentSelection("grow"))}>Grow selection</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => dispatch(requestComponentSelection("shrink"))}>Shrink selection</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {selected && <span className="px-1 text-[10px] text-muted-foreground" aria-label={`${componentSelection?.ids.length ?? 0} components selected`}>{componentSelection?.ids.length}</span>}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" className="size-7 rounded-sm [&_svg]:size-4"
                aria-label="Move selected components" disabled={!selected}
                onClick={() => startTool("move")}>
                <Move />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Move selected components · G (R rotates, S scales)</TooltipContent>
          </Tooltip>
          <DropdownMenu onOpenChange={(open) => {
            extrudeMenuOpen.current = open;
            if (open) suppressExtrudeTooltip.current = true;
            setExtrudeTooltip(false);
          }}>
            <Tooltip open={extrudeTooltip} onOpenChange={(open) => setExtrudeTooltip(open && !suppressExtrudeTooltip.current)}>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" className="size-7 rounded-sm [&_svg]:size-4" aria-label="Extrusion tools" disabled={!selected}
                    onPointerEnter={() => {
                      if (!extrudeMenuOpen.current) suppressExtrudeTooltip.current = false;
                    }}
                    onBlur={() => {
                      if (!extrudeMenuOpen.current) suppressExtrudeTooltip.current = false;
                    }}>
                    <BoxSelect />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>Extrusion tools · E</TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => startTool("extrude")}>Extrude region <span className="ml-auto text-muted-foreground">E</span></DropdownMenuItem>
              <DropdownMenuItem disabled={componentKind !== "face"} onSelect={() => startTool("normals")}>Extrude along vertex normals</DropdownMenuItem>
              <DropdownMenuItem disabled={componentKind !== "face"} onSelect={() => startTool("individual")}>Extrude individual faces</DropdownMenuItem>
              <DropdownMenuItem disabled={componentKind !== "face"} onSelect={() => startTool("solid")}>Extrude planar sheet as solid</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" className="size-7 rounded-sm [&_svg]:size-4"
                aria-label="Inset selected faces" disabled={!selected || componentKind !== "face"}
                onClick={() => startTool("inset")}>
                <SquareDashed />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Inset selected faces · I</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="icon-sm" variant="ghost" className="size-7 rounded-sm [&_svg]:size-4"
                aria-label="Bevel selected edges" disabled={!selected || componentKind !== "edge"}
                onClick={() => startTool("bevel")}>
                <Blend />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Bevel selected edges · Ctrl+B</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon-sm"
                variant="ghost"
                className="size-7 rounded-sm [&_svg]:size-4"
                aria-label="Subdivide selected faces"
                disabled={!scene || !canSubdivide}
                onClick={subdivide}
              >
                <Grid2x2 />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {canSubdivide ? "Subdivide selected faces" : "Select faces to subdivide"}
            </TooltipContent>
          </Tooltip>
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
          <KnifeToolMenu start={startKnife} disabled={!scene} />
          <MeshCleanupMenu scene={scene} saves={saves} disabled={disabled} />
        </fieldset>
      </TooltipProvider>
      {componentError && (
        <p
          role="alert"
          className="absolute top-10 left-0 w-64 rounded-lg border border-border bg-popover p-3 text-xs shadow-xl"
        >
          {componentError}
        </p>
      )}
    </div>
  );
}
