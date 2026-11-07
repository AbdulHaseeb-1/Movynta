import type { MeshModifierSpec } from "@movynta/editor-protocol";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrubNumberInput } from "./ScrubNumberInput";

interface Props {
  entry: Extract<MeshModifierSpec, { kind: "array" | "mirror" }>;
  locked: boolean;
  onChange: (entry: MeshModifierSpec) => void;
}
/** The input fields for one array or mirror modifier entry. */
export function RepetitionFields({ entry, locked, onChange }: Props) {
  if (entry.kind === "array")
    return (
      <div className="mt-1 space-y-1">
        <ScrubNumberInput
          caption="Count"
          id={`${entry.id}-count`}
          label="Array total instance count"
          min={1}
          max={64}
          step={1}
          value={entry.count}
          disabled={locked}
          onChange={(value) => onChange({ ...entry, count: Math.round(value) })}
        />
        <div className="grid grid-cols-3 gap-1">
          {["X", "Y", "Z"].map((label, axis) => (
            <ScrubNumberInput
              key={label}
              caption={label}
              id={`${entry.id}-offset-${axis}`}
              label={`Array local offset ${label}`}
              min={-10000}
              max={10000}
              step={0.1}
              value={entry.offset[axis] ?? 0}
              disabled={locked}
              onChange={(value) =>
                onChange({ ...entry, offset: entry.offset.map((old, i) => (i === axis ? value : old)) })
              }
            />
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground">Offset per instance · local units · copies stay separate</p>
      </div>
    );
  return (
    <div className="mt-1 space-y-1">
      <div className="flex gap-1">
        <Select
          value={entry.axis}
          disabled={locked}
          onValueChange={(axis) => {
            if (axis === "x" || axis === "y" || axis === "z") onChange({ ...entry, axis });
          }}
        >
          <SelectTrigger className="h-6 w-16 px-1.5 text-[11px]" aria-label="Mirror axis">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["x", "y", "z"].map((axis) => (
              <SelectItem key={axis} value={axis}>
                {axis.toUpperCase()}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ScrubNumberInput
          caption="Plane"
          className="min-w-0 flex-1"
          id={`${entry.id}-origin`}
          label="Mirror plane coordinate in local units"
          min={-10000}
          max={10000}
          step={0.1}
          value={entry.origin}
          disabled={locked}
          onChange={(origin) => onChange({ ...entry, origin })}
        />
      </div>
      <div className="flex gap-1">
        <Button
          size="sm"
          className="h-6 flex-1 text-[11px]"
          variant={entry.bisect ? "secondary" : "outline"}
          disabled={locked}
          aria-pressed={entry.bisect}
          onClick={() => onChange({ ...entry, bisect: !entry.bisect })}
        >
          Bisect
        </Button>
        <Select
          value={entry.keepSide}
          disabled={locked}
          onValueChange={(keepSide) => {
            if (keepSide === "positive" || keepSide === "negative") onChange({ ...entry, keepSide });
          }}
        >
          <SelectTrigger className="h-6 min-w-0 flex-1 px-1.5 text-[11px]" aria-label="Mirror retained side">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="positive">Keep + side</SelectItem>
            <SelectItem value="negative">Keep − side</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <ScrubNumberInput
        caption="Seam tolerance"
        id={`${entry.id}-merge`}
        label="Mirror seam tolerance"
        min={0}
        max={1}
        step={0.00001}
        value={entry.mergeDistance}
        disabled={locked}
        onChange={(mergeDistance) => onChange({ ...entry, mergeDistance })}
      />
      <p className="text-[10px] text-muted-foreground">Edits to the base regenerate the mirrored side.</p>
    </div>
  );
}
