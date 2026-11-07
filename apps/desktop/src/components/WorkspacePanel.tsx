import { useId, type ComponentType, type ReactNode } from "react";
import type { LucideProps } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { setPanelOpen } from "@/features/designWorkspace/workspaceSlice";
import type { PanelId } from "@/features/designWorkspace/panelStorage";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface WorkspacePanelProps {
  label: string;
  panelId: PanelId;
  icon: ComponentType<LucideProps>;
  children: ReactNode;
  /** Keeps actionable errors and in-progress saves visible. */
  forceOpen?: boolean;
}

/** A compact launcher that keeps its panel mounted while collapsed. */
export function WorkspacePanel({ label, panelId, icon: Icon, children, forceOpen = false }: WorkspacePanelProps) {
  const dispatch = useAppDispatch();
  const open = useAppSelector((state) => state.designWorkspace.panels[panelId]);
  const id = useId();
  const expanded = open || forceOpen;
  return (
    <div className="pointer-events-none flex w-full shrink-0 flex-col items-end">
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="pointer-events-auto size-8 rounded-xl border border-border bg-card/95 text-muted-foreground shadow-xl hover:bg-accent hover:text-foreground data-[state=open]:bg-accent data-[state=open]:text-foreground"
              aria-label={`${expanded ? "Close" : "Open"} ${label}`}
              aria-expanded={expanded}
              aria-controls={id}
              data-state={expanded ? "open" : "closed"}
              onClick={() => {
                if (!forceOpen) dispatch(setPanelOpen({ id: panelId, open: !open }));
              }}
            >
              <Icon className="size-4" aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">
            {expanded ? "Close" : "Open"} {label}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <div
        id={id}
        aria-hidden={!expanded}
        inert={!expanded}
        className={cn(
          "grid w-full transition-[grid-template-rows,opacity,margin] duration-300 ease-out motion-reduce:transition-none",
          expanded ? "pointer-events-auto mt-2 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
