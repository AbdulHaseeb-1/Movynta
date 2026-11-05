import { useEffect, useRef, useState } from "react";
import { ChevronDown, Combine, Eraser, LoaderCircle, PanelTopClose } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import type { EditorScene } from "@/features/assistant";
import { extrudeIsActive } from "@/features/objectEditing/ExtrudeGesture";
import { errorMessage, type SerialQueue } from "@/lib";
import { cleanupSelection, type CleanupAction } from "./cleanupSelection";
import { setComponentError } from "./workspaceSlice";

interface MeshCleanupMenuProps { scene: EditorScene | null; saves: SerialQueue; disabled: boolean }

export function MeshCleanupMenu({ scene, saves, disabled }: MeshCleanupMenuProps) {
  const dispatch = useAppDispatch();
  const { componentKind, componentSelection } = useAppSelector((state) => state.designWorkspace);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const count = componentSelection?.ids.length ?? 0;
  const merge = componentKind === "vertex" && count >= 2 && count <= 4096;
  const edges = componentKind === "edge" && count > 0;
  const locked = disabled || busy || !scene || scene.requiresRecovery;
  const run = (action: CleanupAction) => {
    if (locked || pending.current || !scene || !componentSelection || extrudeIsActive()) return;
    const choice = { ...componentSelection, meshPath: [...componentSelection.meshPath], ids: [...componentSelection.ids] };
    const revision = scene.currentRevision;
    dispatch(setComponentError(""));
    setOpen(false); setBusy(true); pending.current = true;
    saves.run(async () => {
      try { await cleanupSelection(scene, choice, revision, action); }
      finally { pending.current = false; setBusy(false); }
    }, (error) => dispatch(setComponentError(errorMessage(error))));
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || locked || open || extrudeIsActive()) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) || target.closest('[role="menu"]'))) return;
      if (event.key.toLowerCase() === "m" && merge) { event.preventDefault(); setOpen(true); }
      if (event.key.toLowerCase() === "f" && edges && count >= 3 && count <= 256) { event.preventDefault(); run("fill"); }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" disabled={locked} aria-label="Mesh cleanup tools" aria-keyshortcuts={merge ? "M" : undefined} title="Mesh cleanup tools · M opens the menu with vertices selected" aria-busy={busy} className="h-7 gap-1 rounded-sm px-2 text-[11px]">
          {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Combine className="size-3.5" />} Mesh <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 border border-border p-1.5">
        <DropdownMenuLabel>Mesh cleanup · {count} {componentKind === "vertex" ? "vertices" : componentKind === "edge" ? "edges" : "faces"} selected</DropdownMenuLabel>
        <p className="px-2 pb-2 text-[11px] leading-4 text-muted-foreground">Choose vertices to merge, or edges to dissolve or fill. Changes save immediately and support Undo.</p>
        <DropdownMenuItem disabled={!merge} onSelect={() => run("merge-center")}><Combine /><div className="flex-1"><div>Merge at center</div><div className="text-[11px] text-muted-foreground">Collapse to the average position</div></div></DropdownMenuItem>
        <DropdownMenuItem disabled={!merge} onSelect={() => run("merge-first")}><div className="pl-6">Merge at first selected vertex</div></DropdownMenuItem>
        <DropdownMenuItem disabled={!merge} onSelect={() => run("merge-last")}><div className="pl-6">Merge at last selected vertex</div></DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled={!edges} onSelect={() => run("dissolve")}><Eraser /><div><div>Dissolve edges</div><div className="text-[11px] text-muted-foreground">Remove coplanar internal edges</div></div></DropdownMenuItem>
        <DropdownMenuItem disabled={!edges || count < 3 || count > 256} onSelect={() => run("fill")}><PanelTopClose /><div className="flex-1"><div>Fill hole</div><div className="text-[11px] text-muted-foreground">Close one selected boundary loop</div></div><span className="text-xs text-muted-foreground">F</span></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
