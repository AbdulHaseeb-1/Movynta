import { Slider } from "@/components/ui/slider";

export interface SliderFieldProps {
  /** Used for the label's test id and accessibility. */
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  decimals?: number;
  onChange: (value: number) => void;
}

/** A labelled slider with its current value, used for every live parameter. */
export function SliderField({ id, label, value, min, max, step, unit = "", decimals = 2, onChange }: SliderFieldProps) {
  return (
    <div className="grid gap-1" data-testid={`field-${id}`}>
      <div className="flex items-baseline justify-between gap-2 text-[11px]">
        <label htmlFor={`slider-${id}`} className="text-muted-foreground">
          {label}
        </label>
        <span className="font-mono tabular-nums text-foreground" data-testid={`value-${id}`}>
          {value.toFixed(decimals)}
          {unit}
        </span>
      </div>
      <Slider
        id={`slider-${id}`}
        data-testid={`slider-${id}`}
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(next) => {
          const first = next[0];
          if (first !== undefined) onChange(first);
        }}
      />
    </div>
  );
}
