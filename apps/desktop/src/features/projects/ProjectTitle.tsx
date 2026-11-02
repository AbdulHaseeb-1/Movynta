import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { cn } from "@/lib/utils";
import { PROJECT_NAME_MAX_LENGTH, UNTITLED_PROJECT } from "./projectName";

interface ProjectTitleProps {
  name: string;
  /** Called with the trimmed name; an empty name makes the project untitled. Rejects to keep editing. */
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
  const shared = "h-8 max-w-[min(320px,40vw)] rounded-full px-2.5 text-[13px] font-medium";

  async function commit(event?: FormEvent) {
    event?.preventDefault();
    if (draft === null) return;
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = draft.trim();
    setDraft(null);
    if (next === name.trim()) return;
    await onRename(next).catch(() => undefined);
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      cancelled.current = true;
      setDraft(null);
    }
  }

  if (draft !== null)
    return (
      <form onSubmit={(event) => void commit(event)}>
        <input
          ref={input}
          value={draft}
          maxLength={PROJECT_NAME_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={onKeyDown}
          aria-label="Project name"
          placeholder={UNTITLED_PROJECT}
          className={cn(
            shared,
            "w-64 bg-foreground/10 text-foreground outline-2 outline-ring placeholder:text-muted-foreground",
            className,
          )}
        />
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
