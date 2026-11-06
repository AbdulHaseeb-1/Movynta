import { Button } from "@/components/ui/button";

interface Props<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

/** A row of buttons of which exactly one is chosen, for a handful of named options. */
export function SegmentedChoice<T extends string>({ label, value, options, onChange, disabled = false }: Props<T>) {
  return <fieldset className="m-0 grid min-w-0 gap-2 border-0 p-0 text-sm">
    <legend className="mb-2 p-0">{label}</legend>
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => <Button key={option.value} type="button" size="sm" variant={option.value === value ? "default" : "outline"} aria-pressed={option.value === value} disabled={disabled} onClick={() => onChange(option.value)}>{option.label}</Button>)}
    </div>
  </fieldset>;
}
