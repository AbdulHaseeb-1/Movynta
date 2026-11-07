import { useEffect, useRef, useState } from "react";
import { isShortcutBlocked } from "@/lib/dom";
import {
  ChevronDown,
  Combine,
  Eraser,
  FlipHorizontal2,
  Link2,
  LoaderCircle,
  PanelTopClose,
  Scissors,
  SunMedium,
  Split,
  Trash2,
  Triangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import type { EditorScene } from "@/features/assistant";
import { extrudeIsActive } from "@/features/objectEditing/ExtrudeGesture";
import { errorMessage, type SerialQueue } from "@/lib";
import { cleanupSelection, type CleanupAction } from "./cleanupSelection";
import { meshAtPath } from "@/features/meshGeometry";
import { readTopology } from "@/features/meshGeometry/meshTopology";
import { CorrectNormalsDialog } from "./CorrectNormalsDialog";
import { DuplicateFacesDialog } from "./DuplicateFacesDialog";
import { MergeDistanceDialog, type DistanceChoice } from "./MergeDistanceDialog";
import { CutPlaneDialog, type CutChoice } from "./CutPlaneDialog";
import { ShadingDialog, type ShadingChoice } from "./ShadingDialog";
import { applyMeshTool, type MeshToolAction } from "./meshToolActions";
import { meshEdgeDiagnostics } from "./meshDiagnostics";
import { requestDiagnosticSelection, setComponentError } from "./workspaceSlice";

interface MeshCleanupMenuProps {
  scene: EditorScene | null;
  saves: SerialQueue;
  disabled: boolean;
}

/** The Mesh menu: cleanup, topology and modifier actions for the selected mesh. */
export function MeshCleanupMenu({ scene, saves, disabled }: MeshCleanupMenuProps) {
  const dispatch = useAppDispatch();
  const { componentKind, componentSelection, knifeActive } = useAppSelector((state) => state.designWorkspace);
  const [normalsChoice, setNormalsChoice] = useState<DistanceChoice | null>(null);
  const [duplicateChoice, setDuplicateChoice] = useState<DistanceChoice | null>(null);
  const [distanceChoice, setDistanceChoice] = useState<DistanceChoice | null>(null);
  const [cutChoice, setCutChoice] = useState<CutChoice | null>(null);
  const [shadeChoice, setShadeChoice] = useState<ShadingChoice | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // A dialog opened from a menu item would hand the focus back to that item, which is gone; the Mesh button takes it.
  const returnFocus = (event: Event) => {
    event.preventDefault();
    trigger.current?.focus();
  };
  const count = componentSelection?.ids.length ?? 0;
  const merge = componentKind === "vertex" && count >= 2 && count <= 4096;
  const edges = componentKind === "edge" && count > 0;
  const faces = componentKind === "face" && count > 0;
  const kindName = componentKind === "vertex" ? "vertices" : componentKind === "edge" ? "edges" : "faces";
  let diagnostics: ReturnType<typeof meshEdgeDiagnostics> | null = null;
  let diagnosticError = "";
  if (scene && componentKind === "edge" && componentSelection && scene.selection === componentSelection.objectId) {
    try {
      const mesh = meshAtPath(scene.getObject(componentSelection.objectId), componentSelection.meshPath);
      diagnostics = meshEdgeDiagnostics(readTopology(mesh.geometry));
    } catch (error) {
      diagnosticError = errorMessage(error);
    }
  }
  const selectDiagnostic = (ids: string[]) => {
    if (!scene || !componentSelection || !ids.length || extrudeIsActive()) return;
    dispatch(
      requestDiagnosticSelection({
        objectId: componentSelection.objectId,
        meshPath: componentSelection.meshPath,
        ids,
        revision: scene.currentRevision,
      }),
    );
  };
  const unavailable = disabled || knifeActive || !scene || scene.requiresRecovery;
  const locked = unavailable || busy;
  const run = (action: CleanupAction) => {
    if (locked || pending.current || !scene || !componentSelection || extrudeIsActive()) return;
    const choice = {
      ...componentSelection,
      meshPath: [...componentSelection.meshPath],
      ids: [...componentSelection.ids],
    };
    const revision = scene.currentRevision;
    dispatch(setComponentError(""));
    setOpen(false);
    setBusy(true);
    pending.current = true;
    saves.run(
      async () => {
        try {
          await cleanupSelection(scene, choice, revision, action);
        } finally {
          pending.current = false;
          setBusy(false);
        }
      },
      (error) => dispatch(setComponentError(errorMessage(error))),
    );
  };
  /** The same flow as the cleanup tools, for the deletion, separation, orientation, bridging and shading items. */
  const runTool = (action: MeshToolAction) => {
    if (locked || pending.current || !scene || !componentSelection || extrudeIsActive()) return;
    const choice = {
      ...componentSelection,
      meshPath: [...componentSelection.meshPath],
      ids: [...componentSelection.ids],
    };
    const revision = scene.currentRevision;
    dispatch(setComponentError(""));
    setOpen(false);
    setBusy(true);
    pending.current = true;
    saves.run(
      async () => {
        try {
          await applyMeshTool(scene, choice, revision, action);
        } finally {
          pending.current = false;
          setBusy(false);
        }
      },
      (error) => dispatch(setComponentError(errorMessage(error))),
    );
  };
  const chosen = () =>
    componentSelection && scene
      ? {
          ...componentSelection,
          meshPath: [...componentSelection.meshPath],
          ids: [...componentSelection.ids],
          revision: scene.currentRevision,
        }
      : null;
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        locked ||
        open ||
        extrudeIsActive()
      )
        return;
      // A focused button (the Mesh button, once a dialog or menu has handed the focus back) does not use letter keys.
      if (isShortcutBlocked(event.target)) return;
      if (event.key.toLowerCase() === "m" && merge) {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key.toLowerCase() === "f" && edges && count >= 3 && count <= 256) {
        event.preventDefault();
        run("fill");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  return (
    <>
      <DropdownMenu open={open} onOpenChange={(next) => setOpen(next && !locked)}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            size="sm"
            variant="ghost"
            disabled={unavailable}
            aria-disabled={busy || undefined}
            aria-label="Mesh cleanup tools"
            aria-keyshortcuts={merge ? "M" : undefined}
            title="Mesh cleanup tools · M opens the menu with vertices selected"
            aria-busy={busy}
            className="h-7 gap-1 rounded-sm px-2 text-[11px]"
          >
            {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Combine className="size-3.5" />} Mesh{" "}
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          className="max-h-[var(--radix-dropdown-menu-content-available-height)] w-72 overflow-y-auto border border-border p-1.5"
        >
          <DropdownMenuLabel>
            Mesh cleanup · {count}{" "}
            {componentKind === "vertex" ? "vertices" : componentKind === "edge" ? "edges" : "faces"} selected
          </DropdownMenuLabel>
          <p className="px-2 pb-2 text-[11px] leading-4 text-muted-foreground">
            Choose vertices to merge, edges to dissolve, fill or bridge, or faces to delete, separate, flip or
            triangulate. Changes save immediately and support Undo.
          </p>
          <DropdownMenuItem
            disabled={!merge}
            onSelect={() => {
              if (scene && componentSelection)
                setDistanceChoice({
                  ...componentSelection,
                  meshPath: [...componentSelection.meshPath],
                  ids: [...componentSelection.ids],
                  revision: scene.currentRevision,
                });
            }}
          >
            Merge by distance...
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!merge} onSelect={() => run("merge-center")}>
            <Combine />
            <div className="flex-1">
              <div>Merge at center</div>
              <div className="text-[11px] text-muted-foreground">Collapse to the average position</div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!merge} onSelect={() => run("merge-first")}>
            <div className="pl-6">Merge at first selected vertex</div>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!merge} onSelect={() => run("merge-last")}>
            <div className="pl-6">Merge at last selected vertex</div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!edges} onSelect={() => run("dissolve")}>
            <Eraser />
            <div>
              <div>Dissolve edges</div>
              <div className="text-[11px] text-muted-foreground">Remove coplanar internal edges</div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!edges || count < 3 || count > 256} onSelect={() => run("fill")}>
            <PanelTopClose />
            <div className="flex-1">
              <div>Fill hole</div>
              <div className="text-[11px] text-muted-foreground">Close one selected boundary loop</div>
            </div>
            <span className="text-xs text-muted-foreground">F</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!componentSelection || extrudeIsActive()}
            onSelect={() => {
              if (scene && componentSelection)
                setNormalsChoice({
                  ...componentSelection,
                  meshPath: [...componentSelection.meshPath],
                  ids: [...componentSelection.ids],
                  revision: scene.currentRevision,
                });
            }}
          >
            Correct normals...
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!componentSelection || extrudeIsActive()}
            onSelect={() => {
              if (scene && componentSelection)
                setDuplicateChoice({
                  ...componentSelection,
                  meshPath: [...componentSelection.meshPath],
                  ids: [...componentSelection.ids],
                  revision: scene.currentRevision,
                });
            }}
          >
            Remove duplicate faces...
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Delete, separate and orientation</DropdownMenuLabel>
          <DropdownMenuItem disabled={count === 0} onSelect={() => runTool({ type: "delete", kind: componentKind })}>
            <Trash2 />
            <div className="flex-1">
              <div>Delete {kindName}</div>
              <div className="text-[11px] text-muted-foreground">
                {componentKind === "face" ? "Opens the surface where they were" : "Takes the faces around them too"}
              </div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!faces} onSelect={() => runTool({ type: "separate" })}>
            <Split />
            <div className="flex-1">
              <div>Separate to new object</div>
              <div className="text-[11px] text-muted-foreground">Moves the selected faces into their own object</div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!faces} onSelect={() => runTool({ type: "flip" })}>
            <FlipHorizontal2 />
            <div className="flex-1">
              <div>Flip normals</div>
              <div className="text-[11px] text-muted-foreground">Reverses the whole surface the faces belong to</div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!faces} onSelect={() => runTool({ type: "triangulate" })}>
            <Triangle />
            <div className="flex-1">
              <div>Triangulate faces</div>
              <div className="text-[11px] text-muted-foreground">Splits each face into triangles</div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!edges || count < 6} onSelect={() => runTool({ type: "bridge" })}>
            <Link2 />
            <div className="flex-1">
              <div>Bridge edge loops</div>
              <div className="text-[11px] text-muted-foreground">Select every edge of two openings to join them</div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Cut and shade the mesh</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={!componentSelection}
            onSelect={() => {
              const choice = chosen();
              setCutChoice(choice ? { ...choice, faceSelection: faces } : null);
            }}
          >
            <Scissors />
            <div className="flex-1">
              <div>Cut with plane…</div>
              <div className="text-[11px] text-muted-foreground">Cut across the mesh at a position on an axis</div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!componentSelection} onSelect={() => setShadeChoice(chosen())}>
            <SunMedium />
            <div className="flex-1">
              <div>Shading…</div>
              <div className="text-[11px] text-muted-foreground">Flat, smooth, or smooth by angle</div>
            </div>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Mesh diagnostics</DropdownMenuLabel>
          {diagnostics ? (
            <>
              <p className="px-2 pb-1 text-[11px] text-muted-foreground">
                Evaluated mesh - select an issue to highlight its edges
              </p>
              <DropdownMenuItem
                disabled={!diagnostics.boundary.length}
                onSelect={() => selectDiagnostic(diagnostics.boundary)}
              >
                Boundary edges: {diagnostics.boundary.length}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!diagnostics.nonManifold.length}
                onSelect={() => selectDiagnostic(diagnostics.nonManifold)}
              >
                Non-manifold edges: {diagnostics.nonManifold.length}
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!diagnostics.inconsistent.length}
                onSelect={() => selectDiagnostic(diagnostics.inconsistent)}
              >
                Inconsistent winding: {diagnostics.inconsistent.length}
              </DropdownMenuItem>
            </>
          ) : (
            <p className="px-2 pb-2 text-[11px] text-muted-foreground">
              {diagnosticError || "Select an edge on a mesh part to inspect it."}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {normalsChoice && scene && (
        <CorrectNormalsDialog
          scene={scene}
          choice={normalsChoice}
          saves={saves}
          close={() => setNormalsChoice(null)}
          onError={(message) => dispatch(setComponentError(message))}
          onCloseAutoFocus={returnFocus}
        />
      )}
      {duplicateChoice && scene && (
        <DuplicateFacesDialog
          scene={scene}
          choice={duplicateChoice}
          saves={saves}
          close={() => setDuplicateChoice(null)}
          onError={(message) => dispatch(setComponentError(message))}
          onCloseAutoFocus={returnFocus}
        />
      )}
      {cutChoice && scene && (
        <CutPlaneDialog
          scene={scene}
          choice={cutChoice}
          saves={saves}
          close={() => setCutChoice(null)}
          onError={(message) => dispatch(setComponentError(message))}
          onCloseAutoFocus={returnFocus}
        />
      )}
      {shadeChoice && scene && (
        <ShadingDialog
          scene={scene}
          choice={shadeChoice}
          saves={saves}
          close={() => setShadeChoice(null)}
          onError={(message) => dispatch(setComponentError(message))}
          onCloseAutoFocus={returnFocus}
        />
      )}
      {distanceChoice && scene && (
        <MergeDistanceDialog
          scene={scene}
          choice={distanceChoice}
          saves={saves}
          close={() => setDistanceChoice(null)}
          onError={(message) => dispatch(setComponentError(message))}
          onCloseAutoFocus={returnFocus}
        />
      )}
    </>
  );
}
