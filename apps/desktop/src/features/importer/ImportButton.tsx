import { useRef, type ChangeEvent } from "react";
import { FileInput, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  MODEL_FILE_ACCEPT,
  MODEL_FORMATS,
  MODEL_FORMAT_NAMES,
} from "./modelFormats";
import type { ModelImport } from "./useModelImport";

interface ImportButtonProps {
  importer: ModelImport;
  /** Importing is paused while the assistant is working, so it never edits a scene that is changing. */
  disabled?: boolean;
  className?: string;
}

const formatList = MODEL_FORMATS.map((format) => MODEL_FORMAT_NAMES[format]).join(", ");

/** Opens the file dialog for a 3D model and reports how the import went. */
export function ImportButton({
  importer,
  disabled = false,
  className,
}: ImportButtonProps) {
  const input = useRef<HTMLInputElement>(null);

  function onPick(event: ChangeEvent<HTMLInputElement>) {
    const [file] = event.target.files ?? [];
    // Picking the same file again must still count as a choice.
    event.target.value = "";
    if (file) void importer.importFile(file);
  }

  const blocked = disabled || importer.importing;
  return (
    <div className={cn("flex flex-col items-end gap-2", className)}>
      <input
        ref={input}
        type="file"
        accept={MODEL_FILE_ACCEPT}
        onChange={onPick}
        className="hidden"
        tabIndex={-1}
        aria-label="Choose a 3D model file"
      />
      <Button
        type="button"
        variant="ghost"
        disabled={blocked}
        onClick={() => input.current?.click()}
        title={
          disabled && !importer.importing
            ? "Wait for the assistant to finish before importing"
            : `Import a 3D model (${formatList})`
        }
        aria-label="Import a 3D model"
        className="h-8 items-center gap-1.5 rounded-full bg-black/60 px-3 text-xs leading-none text-foreground shadow-2xl backdrop-blur-2xl backdrop-saturate-150 hover:bg-foreground/10"
      >
        {importer.importing ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <FileInput className="size-3.5" aria-hidden="true" />
        )}
        {importer.importing ? "Importing…" : "Import"}
      </Button>
      {importer.error && <Message kind="alert" text={importer.error} onDismiss={importer.dismissError} />}
      {!importer.error && importer.notice && <Message kind="status" text={importer.notice} onDismiss={importer.dismissNotice} />}
    </div>
  );
}

function Message({ kind, text, onDismiss }: { kind: "alert" | "status"; text: string; onDismiss: () => void }) {
  const className = "flex w-[min(320px,calc(100vw-32px))] items-start gap-2.5 rounded-xl bg-popover p-3.5 text-xs leading-5 text-popover-foreground shadow-xl ring-1 ring-border";
  const Box = kind === "alert" ? "div" : "output";
  return (
    <Box role={kind === "alert" ? "alert" : undefined} className={className}>
      <p className="min-w-0 flex-1">{text}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid size-5 shrink-0 place-items-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <X className="size-3.5" />
      </button>
    </Box>
  );
}
