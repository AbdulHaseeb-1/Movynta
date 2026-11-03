/* eslint-disable jsx-a11y/prefer-tag-over-role -- The visible label is a keyboard-accessible scrub control alongside the editable input. */
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useNumberScrub } from "./useNumberScrub";

interface ScrubNumberInputProps {
  id: string;
  label: string;
  caption: string;
  className?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
}
export function ScrubNumberInput({
  id,
  label,
  caption,
  className,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: ScrubNumberInputProps) {
  const scrub = useNumberScrub({
    value,
    min,
    max,
    step,
    disabled,
    onPreview: onChange,
    onCommit: onChange,
    onCancel: onChange,
  });
  return (
    <label
      htmlFor={id}
      className={cn("text-[10px] text-muted-foreground", className)}
    >
      <span
        role="spinbutton"
        tabIndex={disabled ? -1 : 0}
        aria-label={`${label} adjustment`}
        aria-valuenow={Number.isFinite(value) ? value : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-disabled={disabled}
        className={cn(
          "touch-none select-none",
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
          event.preventDefault(); event.stopPropagation();
          const sign = event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : -1;
          onChange(Math.max(min, Math.min(max, Number((value + sign * step).toFixed(6)))));
        }}
      >
        {caption}
      </span>
      <Input
        id={id}
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(value) ? value : ""}
        disabled={disabled}
        className="mt-1 h-7 px-2 text-xs"
        onChange={(event) => onChange(event.target.valueAsNumber)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            scrub.cancel();
            event.stopPropagation();
          }
        }}
      />
    </label>
  );
}
