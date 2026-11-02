import { useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { formatNumber, parseNumber } from "./transformMath";

interface NumberFieldProps {
  /** The axis, shown in front of the number. */
  label: string;
  value: number;
  /** How much the arrow keys change the value; Shift makes it ten times larger. */
  step: number;
  disabled?: boolean;
  /** Called with a valid number when the user finishes typing. */
  onCommit: (value: number) => void;
  className?: string;
}

/**
 * A number the user can type. The text is kept as typed until Enter or leaving the field, so a value
 * is never half-applied; Escape discards what was typed, and an invalid entry is ignored.
 */
export function NumberField({
  label,
  value,
  step,
  disabled = false,
  onCommit,
  className,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);

  function finish(commit: boolean) {
    if (draft === null) return;
    setDraft(null);
    const next = commit ? parseNumber(draft) : undefined;
    if (next !== undefined && next !== value) onCommit(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      // Leaving the field this way must not also clear the selection behind it.
      event.stopPropagation();
      setDraft(null);
      event.currentTarget.blur();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const amount = (event.shiftKey ? step * 10 : step) * (event.key === "ArrowUp" ? 1 : -1);
      setDraft(null);
      onCommit(Number((value + amount).toFixed(6)));
    }
  }

  return (
    <label
      className={cn(
        "flex h-7 min-w-0 items-center gap-1.5 rounded-md bg-foreground/[0.07] px-2 focus-within:bg-foreground/[0.12] focus-within:outline-2 focus-within:outline-ring",
        disabled && "opacity-50",
        className,
      )}
    >
      <span className="w-2.5 shrink-0 text-[10px] font-medium text-muted-foreground">
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={draft ?? formatNumber(value)}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => {
          setDraft(formatNumber(value));
          event.currentTarget.select();
        }}
        onBlur={() => finish(true)}
        onKeyDown={onKeyDown}
        aria-label={label}
        className="w-full min-w-0 bg-transparent text-right text-[12px] tabular-nums outline-none"
      />
    </label>
  );
}
