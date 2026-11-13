import { useState } from "react";
import { Code2 } from "lucide-react";
import { z } from "zod";
import { editorCommandListSchema } from "@movynta/editor-protocol";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { EditorScene } from "@/features/assistant";
import { saveManualCommands } from "@/features/objectEditing/saveManualCommands";
import { backendRequest, errorMessage, type SerialQueue } from "@/lib";

const example = `// Return editor commands. Each object and command needs a unique ID.
const suffix = String(scene.revision);
return Array.from({ length: 5 }, (_, i) => ({
  commandId: 'post_command_' + suffix + '_' + i,
  type: 'geometry.create_primitive',
  objectId: 'post_' + suffix + '_' + i,
  primitive: 'box',
  size: 1,
  name: 'Post ' + (i + 1),
  transform: { position: [i * 1.5, 0.5, 0] },
}));`;

interface ScriptEditorProps {
  scene: EditorScene | null;
  ensureProject: () => Promise<string>;
  saves: SerialQueue;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  onAdded: () => void;
}

/** Runs a program in the backend sandbox, then saves its commands as one manual edit. */
export function ScriptEditor({
  scene,
  ensureProject,
  saves,
  disabled,
  onBusyChange,
  onAdded,
}: ScriptEditorProps) {
  const [source, setSource] = useState(example);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  function run() {
    if (!scene || busy || disabled) return;
    setBusy(true);
    onBusyChange(true);
    setMessage("");
    saves.run(
      async () => {
        try {
          const projectId = await ensureProject();
          scene.bindProject(projectId);
          const snapshot = scene.context();
          const result = await backendRequest(
            `/projects/${projectId}/scene/script`,
            z.object({
              commands: editorCommandListSchema,
              revision: z.number(),
            }),
            "POST",
            { source, scene: snapshot },
          );
          if (scene.currentRevision !== result.revision)
            throw new Error(
              "The scene changed while the script ran. Run it again.",
            );
          await saveManualCommands(scene, result.commands);
          setMessage(
            `Applied ${result.commands.length} command${result.commands.length === 1 ? "" : "s"}. Undo to revert.`,
          );
          onAdded();
        } finally {
          setBusy(false);
          onBusyChange(false);
        }
      },
      (failure) => setMessage(errorMessage(failure)),
    );
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          className="h-8 gap-1.5 rounded-full border border-border bg-card px-3 text-xs"
          disabled={disabled || !scene}
        >
          <Code2 className="size-3.5" />
          Script
        </Button>
      </DialogTrigger>
      <DialogContent className="w-[min(760px,calc(100vw-32px))]">
        <DialogTitle>JavaScript modeling</DialogTitle>
        <DialogDescription>
          Return an array of editor commands. The script receives a snapshot as{" "}
          <code>scene</code>; it cannot access files, the network, imports, or
          asynchronous APIs.
        </DialogDescription>
        <label htmlFor="model-script" className="text-sm font-medium">
          Script
        </label>
        <textarea
          id="model-script"
          spellCheck={false}
          value={source}
          onChange={(event) => setSource(event.target.value)}
          maxLength={16000}
          className="h-80 w-full resize-y rounded-md border border-input bg-background p-3 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        />
        <p className="text-xs text-muted-foreground">
          Up to 200 commands, 16,000 characters and 250 ms. Scripts are not
          saved with the project; the resulting model is.
        </p>
        {message && (
          <output className="text-sm text-foreground">{message}</output>
        )}
        <div>
          <Button onClick={run} disabled={busy || disabled || !source.trim()}>
            {busy ? "Running…" : "Run script"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
