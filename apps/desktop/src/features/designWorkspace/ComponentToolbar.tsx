import { CircleDot, Minus, Square } from "lucide-react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { setComponentKind } from "./workspaceSlice";

export function ComponentToolbar() {
  const dispatch = useAppDispatch();
  const { componentKind, componentSelection, componentError } = useAppSelector(
    (state) => state.designWorkspace,
  );
  return (
    <section
      aria-label="Mesh selection"
      className="rounded-xl border border-border bg-card/95 p-3 shadow-xl"
    >
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-medium">Mesh selection</h2>
        <span className="text-[10px] text-muted-foreground">
          {componentSelection?.ids.length ?? 0} selected
        </span>
      </header>
      <TooltipProvider>
        <div className="flex gap-1">
          {(
            [
              ["vertex", "Vertices", CircleDot],
              ["edge", "Edges", Minus],
              ["face", "Faces", Square],
            ] as const
          ).map(([kind, label, Icon]) => (
            <Tooltip key={kind}>
              <TooltipTrigger asChild>
                <Button
                  size="icon-sm"
                  variant={componentKind === kind ? "secondary" : "ghost"}
                  className="h-7 flex-1 [&_svg]:size-3.5"
                  aria-label={`Select ${label.toLowerCase()}`}
                  aria-pressed={componentKind === kind}
                  onClick={() => dispatch(setComponentKind(kind))}
                >
                  <Icon />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {label} · Shift-click to add or remove
              </TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        Select an object, then click its{" "}
        {componentKind === "vertex" ? "vertices" : `${componentKind}s`}.
        Shift-click adds or removes.
      </p>
      {componentError && (
        <p role="alert" className="mt-2 text-[11px] leading-4">
          {componentError}
        </p>
      )}
    </section>
  );
}
