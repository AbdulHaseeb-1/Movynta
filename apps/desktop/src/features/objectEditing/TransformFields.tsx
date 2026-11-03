import type { ReactNode } from "react";
import type { ObjectTransform } from "@/features/assistant";
import { NumberField } from "./NumberField";
import {
  AXES,
  degreesToRadians,
  radiansToDegrees,
  withAxis,
} from "./transformMath";

interface TransformFieldsProps {
  transform: ObjectTransform;
  /** True while the values are shown but must not be changed. */
  disabled: boolean;
  onChange: (patch: Partial<ObjectTransform>) => void;
  onPreview: (patch: Partial<ObjectTransform>) => void;
  onPreviewEnd: (commit: boolean) => void;
}

/**
 * Location, rotation (in degrees) and scale as typed numbers: the values of any object. Typing
 * a value does the same as dragging a handle, and is saved the same way.
 */
export function TransformFields({ transform, disabled, onChange, onPreview, onPreviewEnd }: TransformFieldsProps) {
  const { position, rotation, scale } = transform;
  const degrees = radiansToDegrees(rotation);

  return (
    <div className="flex flex-col gap-2">
      <Row label="Location">
        {AXES.map(({ label, index }) => (
          <NumberField
            key={label}
            label={label}
            value={position[index]}
            step={0.1}
            disabled={disabled}
            onCommit={(value) => onChange({ position: withAxis(position, index, value) })}
            onPreview={(value) => onPreview({ position: withAxis(position, index, value) })}
            onPreviewEnd={onPreviewEnd}
          />
        ))}
      </Row>
      <Row label="Rotation">
        {AXES.map(({ label, index }) => (
          <NumberField
            key={label}
            label={label}
            value={degrees[index]}
            step={1}
            disabled={disabled}
            onCommit={(value) =>
              onChange({ rotation: degreesToRadians(withAxis(degrees, index, value)) })
            }
            onPreview={(value) => onPreview({ rotation: degreesToRadians(withAxis(degrees, index, value)) })}
            onPreviewEnd={onPreviewEnd}
          />
        ))}
      </Row>
      <Row label="Scale">
        {AXES.map(({ label, index }) => (
          <NumberField
            key={label}
            label={label}
            value={scale[index]}
            step={0.1}
            min={0.001}
            onPreview={(value) => onPreview({ scale: withAxis(scale, index, value) })}
            onPreviewEnd={onPreviewEnd}
            disabled={disabled}
            onCommit={(value) => {
              // Something with no size cannot be selected or seen again, so zero is not accepted.
              if (value === 0) return;
              onChange({ scale: withAxis(scale, index, value) });
            }}
          />
        ))}
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <div className="grid grid-cols-3 gap-1.5">{children}</div>
    </div>
  );
}
