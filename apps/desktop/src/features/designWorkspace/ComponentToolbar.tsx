import { Grid2x2 } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import type { EditorScene } from "@/features/assistant";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { errorMessage, type SerialQueue } from "@/lib";
import { setComponentError, setComponentKind } from "./workspaceSlice";
import { MeshSelectionIcon } from "./MeshSelectionIcon";
import { subdivideSelectedFaces } from "./subdivideSelection";

interface ComponentToolbarProps {
  scene: EditorScene | null;
  saves: SerialQueue;
}

export function ComponentToolbar({ scene, saves }: ComponentToolbarProps) {
  const dispatch = useAppDispatch();
  const { componentKind, componentError, componentSelection } = useAppSelector(
    (state) => state.designWorkspace,
  );
  const canSubdivide = componentKind === "face" && (componentSelection?.ids.length ?? 0) > 0;
  const subdivide = () => {
    if (!scene || !componentSelection) return;
    dispatch(setComponentError(""));
    subdivideSelectedFaces(scene, componentSelection, saves, (failure) => dispatch(setComponentError(errorMessage(failure))));
  };
  return (
    <div className="relative">
      <TooltipProvider>
        <fieldset
          aria-label="Mesh selection"
          className="flex h-8 items-center gap-0.5 rounded-md border border-border bg-card p-0.5 shadow-xl"
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
                {label} · Shift-click to add or remove
              </TooltipContent>
            </Tooltip>
          ))}
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
