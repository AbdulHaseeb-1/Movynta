/* eslint-disable jsx-a11y/prefer-tag-over-role -- The visible text label is a keyboard-accessible unbounded scrub control alongside the editable input. */
import { useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { fieldCommitValue, formatNumber } from "./transformMath";
import { useNumberScrub } from "./useNumberScrub";

interface NumberFieldProps {
  /** The axis, shown in front of the number. */
  label: string;
  value: number;
  /** How much the arrow keys change the value; Shift makes it ten times larger. */
  step: number;
  min?: number;
  disabled?: boolean;
  /** Called with a valid number when the user finishes typing. */
  onCommit: (value: number) => void;
  onPreview?: (value: number) => void;
  onPreviewEnd?: (commit: boolean) => void;
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
  min,
  disabled = false,
  onCommit,
  onPreview,
  onPreviewEnd,
  className,
}: NumberFieldProps) {
  const [draft, setDraft] = useState<string | null>(null);
  // Set by Escape so the blur that follows it does not apply the text that was typed. State would still be stale there.
  const cancelled = useRef(false);
  const atLeast = (next: number) => (min === undefined ? next : Math.max(min, next));
  const scrub = useNumberScrub({
    value,
    step,
    ...(min === undefined ? {} : { min }),
    disabled,
    onPreview: (next) => {
      setDraft(formatNumber(next));
      onPreview?.(next);
    },
    onCommit: (next) => {
      setDraft(null);
      if (onPreviewEnd) onPreviewEnd(true);
      else if (next !== value) onCommit(next);
    },
    onCancel: () => {
      setDraft(null);
      onPreviewEnd?.(false);
    },
  });

  function finish(commit: boolean) {
    if (draft === null) return;
    const wasCancelled = cancelled.current;
    cancelled.current = false;
    setDraft(null);
    if (!commit) return;
    const next = fieldCommitValue(draft, value, { min, cancelled: wasCancelled });
    if (next !== undefined) onCommit(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.currentTarget.blur();
    } else if (event.key === "Escape") {
      // Leaving the field this way must not also clear the selection behind it.
      event.stopPropagation();
      scrub.cancel();
      cancelled.current = true;
      setDraft(null);
      event.currentTarget.blur();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const amount = (event.shiftKey ? step * 10 : step) * (event.key === "ArrowUp" ? 1 : -1);
      setDraft(null);
      onCommit(atLeast(Number((value + amount).toFixed(6))));
    }
  }

  return (
    <label
      className={cn(
        "flex h-6 min-w-0 items-center gap-1 rounded-md bg-foreground/[0.07] px-1.5 focus-within:bg-foreground/[0.12] focus-within:outline-2 focus-within:outline-ring",
        disabled && "opacity-50",
        className,
      )}
    >
      <span
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${label} adjustment`}
        aria-valuenow={value}
        aria-valuemin={min}
        aria-disabled={disabled}
        className={cn(
          "w-2.5 shrink-0 touch-none select-none text-[10px] font-medium text-muted-foreground",
          !disabled && "cursor-ew-resize",
        )}
        title="Drag left or right to adjust; hold Shift for precision. Click the number to type."
        onPointerDown={scrub.onPointerDown}
        onPointerMove={scrub.onPointerMove}
        onPointerUp={scrub.onPointerUp}
        onPointerCancel={scrub.onPointerCancel}
        onLostPointerCapture={scrub.onLostPointerCapture}
        onClick={scrub.onClick}
        onKeyDown={(event) => {
          if (disabled || !["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          const sign = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
          onCommit(Math.max(min ?? -Infinity, Number((value + sign * step * (event.shiftKey ? 0.1 : 1)).toFixed(6))));
        }}
      >
        {label}
      </span>
      <input
        type="text"
        inputMode="decimal"
        disabled={disabled}
        value={draft ?? formatNumber(value)}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => {
          cancelled.current = false;
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
