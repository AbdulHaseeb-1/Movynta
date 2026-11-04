import { useEffect, useState } from "react";
import { Box, Eye, EyeOff, Layers3 } from "lucide-react";
import type { EditorScene } from "@/features/assistant";
import { cn } from "@/lib/utils";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { saveManualCommands } from "@/features/objectEditing/saveManualCommands";
import { errorMessage, type SerialQueue } from "@/lib";

interface DesignWorkspacePanelProps {
  scene: EditorScene | null;
  saves: SerialQueue;
  disabled: boolean;
}

export function DesignWorkspacePanel({ scene, saves, disabled }: DesignWorkspacePanelProps) {
  const [, refresh] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(
    () => scene?.onChange(() => refresh((value) => value + 1)),
    [scene],
  );
  const objects = scene ? [...scene.entries()] : [];

  return (
    <div className="pointer-events-auto w-full space-y-3">
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
                <div key={id} className={cn("flex items-center rounded-md hover:bg-accent", scene?.selectedIds.includes(id) && "bg-accent")}>
                  <button type="button" onClick={() => scene?.select(id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left text-xs">
                    <Box className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{object.name || id}</span>
                  </button>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button type="button" variant="ghost" size="icon-sm" className="size-7 shrink-0 [&_svg]:size-3.5"
                          aria-label={`${object.visible ? "Hide" : "Show"} ${object.name || id}`}
                          disabled={!scene || disabled || busy || scene.requiresRecovery}
                          onClick={() => {
                            if (!scene) return;
                            setBusy(true); setError("");
                            saves.run(async () => {
                              try {
                                await saveManualCommands(scene, [{ commandId: `visibility_${crypto.randomUUID()}`, type: "scene.set_visibility", objectId: id, visible: !object.visible }]);
                              } finally { setBusy(false); }
                            }, (failure) => setError(errorMessage(failure)));
                          }}>
                          {object.visible ? <Eye /> : <EyeOff />}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{object.visible ? "Hide object" : "Show object"}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </div>
              ))}
            </div>
          )}
          {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
        </section>
      </WorkspacePanel>
    </div>
  );
}
