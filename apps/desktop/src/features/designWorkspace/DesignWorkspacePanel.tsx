import { useEffect, useState } from "react";
import { Box, Layers3, MousePointer2 } from "lucide-react";
import { useAppSelector } from "@/app/hooks";
import { ComponentToolbar } from "./ComponentToolbar";
import type { EditorScene } from "@/features/assistant";
import { cn } from "@/lib/utils";
import { WorkspacePanel } from "@/components/WorkspacePanel";

interface DesignWorkspacePanelProps {
  scene: EditorScene | null;
}

export function DesignWorkspacePanel({ scene }: DesignWorkspacePanelProps) {
  const { mode, componentError } = useAppSelector(
    (state) => state.designWorkspace,
  );
  const [, refresh] = useState(0);
  useEffect(
    () => scene?.onChange(() => refresh((value) => value + 1)),
    [scene],
  );
  const objects = scene ? [...scene.entries()] : [];

  return (
    <div className="pointer-events-auto w-full space-y-3">
      {mode === "edit" && (
        <WorkspacePanel
          panelId="meshSelection"
          label="mesh selection"
          icon={MousePointer2}
          forceOpen={Boolean(componentError)}
        >
          <ComponentToolbar />
        </WorkspacePanel>
      )}
      <WorkspacePanel panelId="scene" label="scene" icon={Layers3}>
        <section
          aria-label="Scene objects"
          className="rounded-xl border border-border bg-card/95 p-3 shadow-xl"
        >
          <div className="mb-2 flex items-center gap-2">
            <Layers3
              className="size-4 text-muted-foreground"
              aria-hidden="true"
            />
            <h2 className="flex-1 text-xs font-medium">Scene</h2>
            <span className="text-[11px] text-muted-foreground">
              {objects.length}
            </span>
          </div>
          {objects.length === 0 ? (
            <p className="py-3 text-xs leading-5 text-muted-foreground">
              Objects you create or import will appear here.
            </p>
          ) : (
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {objects.map(([id, object]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => scene?.select(id)}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-accent",
                    scene?.selectedIds.includes(id) && "bg-accent",
                  )}
                >
                  <Box className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{object.name || id}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      </WorkspacePanel>
    </div>
  );
}
