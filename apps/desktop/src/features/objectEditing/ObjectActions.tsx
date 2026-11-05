import { useEffect, useRef, useState } from "react";
import { Copy, FlipHorizontal2 } from "lucide-react";
import { useAppDispatch } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import type { EditorScene } from "@/features/assistant";
import { setPanelOpen } from "@/features/designWorkspace/workspaceSlice";
import { errorMessage, type SerialQueue } from "@/lib";
import { saveManualCommands } from "./saveManualCommands";

interface ObjectActionsProps { scene: EditorScene | null; disabled: boolean; saves: SerialQueue }
export function ObjectActions({ scene, disabled, saves }: ObjectActionsProps) {
  const dispatch = useAppDispatch(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const pending = useRef(false);
  const duplicate = () => {
    if (!scene || disabled || pending.current || scene.requiresRecovery || scene.selectedIds.length !== 1 || !scene.selection) return;
    const sourceId = scene.selection; const root = scene.getObject(sourceId); if (!root) return;
    const revision = scene.currentRevision;
    const descendants = [...scene.entries()].filter(([id, object]) => {
      if (id === sourceId) return false;
      for (let parent = object.parent; parent; parent = parent.parent) if (parent === root) return true;
      return false;
    }).map(([id]) => ({ sourceId: id, objectId: `obj_${crypto.randomUUID()}` }));
    const objectId = `obj_${crypto.randomUUID()}`;
    pending.current = true; setBusy(true); setError("");
    saves.run(async () => {
      try {
        if (scene.currentRevision !== revision) throw new Error("The scene changed. Select the object and try again.");
        await saveManualCommands(scene, [{ commandId: `duplicate_${crypto.randomUUID()}`, type: "scene.duplicate_hierarchy", sourceId, copies: [{ objectId, descendants }], offset: [0, 0, 0], space: "parent" }]);
        if (scene.selectedIds.length === 1 && scene.selection === sourceId) scene.select(objectId);
      } finally { pending.current = false; setBusy(false); }
    }, (failure) => setError(errorMessage(failure)));
  };
  const mirror = () => { if (!disabled && scene?.selection) dispatch(setPanelOpen({ id: "modifiers", open: true })); };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (event.defaultPrevented || event.repeat || event.altKey || (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName) || target.closest('[role="dialog"], [role="menu"]')))) return;
      if (event.shiftKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === "d" && !disabled && scene?.selectedIds.length === 1) { event.preventDefault(); duplicate(); }
      else if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "m" && !disabled && scene?.selection) { event.preventDefault(); mirror(); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });
  return <div className="relative flex items-center gap-0.5">
    <Button size="icon" variant="ghost" className="size-7 rounded-full text-muted-foreground" disabled={disabled || busy || scene?.selectedIds.length !== 1} onClick={duplicate} aria-label="Duplicate selected object" title="Duplicate selected object · Shift+D"><Copy className="size-4" /></Button>
    <Button size="icon" variant="ghost" className="size-7 rounded-full text-muted-foreground" disabled={disabled || !scene?.selection} onClick={mirror} aria-label="Open mirror controls" title="Open modifiers for mirror · Ctrl+M"><FlipHorizontal2 className="size-4" /></Button>
    {error && <div role="alert" className="absolute bottom-10 left-0 w-64 rounded-lg border border-border bg-popover p-3 text-xs text-popover-foreground shadow-xl">{error}<Button variant="ghost" size="sm" onClick={() => setError("")}>Dismiss</Button></div>}
  </div>;
}
