import { useState } from "react";
import { Box, Circle, Cone, Cylinder, Diamond, Donut, Plus, Square, Triangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EditorScene } from "@/features/assistant";
import { errorMessage, type SerialQueue } from "@/lib";
import { saveManualCommands } from "@/features/objectEditing/saveManualCommands";
import { useAppDispatch } from "@/app/hooks";
import { setDesignMode } from "./workspaceSlice";

const shapes = [
  ["box", "Cube", Box],
  ["sphere", "Sphere", Circle],
  ["cylinder", "Cylinder", Cylinder],
  ["cone", "Cone", Cone],
  ["torus", "Torus", Donut],
  ["plane", "Plane", Square],
  ["tetrahedron", "Tetrahedron", Triangle],
  ["octahedron", "Octahedron", Diamond],
  ["icosahedron", "Icosahedron", Diamond],
] as const;
interface AddShapeMenuProps {
  scene: EditorScene | null;
  ensureProject: () => Promise<string>;
  saves: SerialQueue;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onAdded: () => void;
}
/** The Add menu: creates a basic shape in the scene and saves it to the project. */
export function AddShapeMenu({ scene, ensureProject, saves, disabled, onBusyChange, onAdded }: AddShapeMenuProps) {
  const dispatch = useAppDispatch();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  function add(primitive: (typeof shapes)[number][0]) {
    if (!scene || disabled || busy) return;
    setError("");
    setBusy(true);
    onBusyChange(true);
    saves.run(
      async () => {
        try {
          scene.bindProject(await ensureProject());
          const objectId = `shape_${crypto.randomUUID()}`;
          const count = [...scene.entries()].length;
          const commands = [
            {
              commandId: `create_${crypto.randomUUID()}`,
              type: "geometry.create_primitive",
              objectId,
              primitive,
              size: 2,
              replaceExisting: false,
            },
            {
              commandId: `place_${crypto.randomUUID()}`,
              type: "scene.transform_object",
              objectId,
              transform: {
                position: [(count % 3) * 3, primitive === "plane" ? 0 : 1, Math.floor(count / 3) * 3],
                rotation: [primitive === "plane" ? -Math.PI / 2 : 0, 0, 0],
              },
            },
          ];
          await saveManualCommands(scene, commands);
          scene.select(objectId);
          dispatch(setDesignMode("object"));
          onAdded();
        } finally {
          setBusy(false);
          onBusyChange(false);
        }
      },
      (failure) => setError(errorMessage(failure)),
    );
  }
  return (
    <div className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-8 gap-1.5 rounded-full border border-border bg-card px-3 text-xs"
            disabled={disabled || busy || !scene}
            aria-label="Add shape"
            title="Add a mesh shape"
          >
            <Plus className="size-3.5" />
            Add
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40 p-1">
          {shapes.map(([kind, label, Icon]) => (
            <DropdownMenuItem key={kind} onSelect={() => add(kind)}>
              <Icon className="size-3.5" />
              {label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <p
          role="alert"
          className="absolute top-10 left-0 w-64 rounded-lg border border-border bg-popover p-3 text-xs shadow-xl"
        >
          {error}
        </p>
      )}
    </div>
  );
}
