import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { PROJECT_NAME_MAX_LENGTH, UNTITLED_PROJECT } from "./projectName";
import { saveTitleEdit } from "./projectTitleEdit";

interface ProjectTitleProps {
  name: string;
  /** Called with the trimmed name; an empty name makes the project untitled. Rejects to keep editing and show why. */
  onRename: (name: string) => Promise<void>;
  /** A project that does not exist yet has nothing to rename. */
  readOnly?: boolean;
  className?: string;
}

/** The project's name in the workspace bar. Click to rename; Enter saves and Escape cancels. */
export function ProjectTitle({
  name,
  onRename,
  readOnly = false,
  className,
}: ProjectTitleProps) {
  const [draft, setDraft] = useState<string | null>(null);
  /** Why the last save failed. The typed name stays in the field so it can be saved again. */
  const [failure, setFailure] = useState("");
  const saving = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  /** Escape ends editing, and removing the field must not then save what was typed. */
  const cancelled = useRef(false);
  const editing = draft !== null;
  // Editing starts from a click, so the field takes focus with its text selected.
  useEffect(() => {
    if (!editing) return;
    input.current?.focus();
    input.current?.select();
  }, [editing]);
  const label = name.trim() || UNTITLED_PROJECT;
  const shared = "h-7 max-w-[min(320px,40vw)] rounded-full px-2 text-xs font-medium";

  async function commit(event?: FormEvent) {
    event?.preventDefault();
    if (draft === null || saving.current) return;
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    saving.current = true;
    setFailure("");
    try {
      const outcome = await saveTitleEdit(draft, name, onRename);
      if (outcome.kind === "failed") {
        if (!cancelled.current) setFailure(outcome.message);
        return;
      }
      setDraft(null);
    } finally {
      saving.current = false;
    }
  }
  function leave() {
    // After a failed save, leaving the field gives the edit up instead of trying again behind the user's back.
    if (failure) {
      setFailure("");
      setDraft(null);
      return;
    }
    void commit();
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      cancelled.current = true;
      setFailure("");
      setDraft(null);
    }
  }

  if (draft !== null)
    return (
      <form onSubmit={(event) => void commit(event)} className="flex items-center gap-2">
        <input
          ref={input}
          value={draft}
          maxLength={PROJECT_NAME_MAX_LENGTH}
          onChange={(event) => {
            setFailure("");
            setDraft(event.target.value);
          }}
          onBlur={leave}
          onKeyDown={onKeyDown}
          aria-label="Project name"
          aria-invalid={failure ? true : undefined}
          title={failure ? `${failure} Press Enter to try again or Esc to cancel.` : undefined}
          placeholder={UNTITLED_PROJECT}
          className={cn(
            shared,
            "w-64 bg-foreground/10 text-foreground outline-2 outline-ring placeholder:text-muted-foreground",
            failure && "outline-destructive",
            className,
          )}
        />
        {failure && (
          <span role="alert" className="max-w-48 truncate text-[11px] text-destructive" title={failure}>
            {failure}
          </span>
        )}
      </form>
    );

  return (
    <button
      type="button"
      disabled={readOnly}
      onClick={() => {
        cancelled.current = false;
        setDraft(name);
      }}
      title={readOnly ? undefined : "Rename project"}
      className={cn(
        shared,
        "truncate text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring enabled:hover:bg-foreground/10",
        name.trim() ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {label}
    </button>
  );
}
