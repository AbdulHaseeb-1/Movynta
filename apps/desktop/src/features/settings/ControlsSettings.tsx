import { ShortcutReference } from "@/features/documentation/components";

/** The Shortcuts page of Settings: the same reference the "?" dialog and the documentation show. */
export function ControlsSettings() {
  return (
    <div className="mx-auto max-w-3xl">
      <ShortcutReference headingId="controls-settings-heading" />
    </div>
  );
}
