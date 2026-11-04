import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { setComponentKind } from "./workspaceSlice";
import { MeshSelectionIcon } from "./MeshSelectionIcon";

export function ComponentToolbar() {
  const dispatch = useAppDispatch();
  const { componentKind, componentError } = useAppSelector(
    (state) => state.designWorkspace,
  );
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
