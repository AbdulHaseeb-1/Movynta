import type { ComponentKind } from "./workspaceSlice";

/** A mesh outline with the selectable part highlighted. */
export function MeshSelectionIcon({ kind }: { kind: ComponentKind }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="3"
        y="3"
        width="10.5"
        height="10.5"
        rx="1.25"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="1.25"
      />
      {kind === "vertex" && <rect x="1.25" y="1.25" width="4" height="4" rx="0.5" fill="currentColor" />}
      {kind === "edge" && <path d="M13.5 4v9" stroke="currentColor" strokeWidth="2.5" />}
      {kind === "face" && <rect x="4.5" y="4.5" width="8" height="8" rx="0.5" fill="currentColor" />}
    </svg>
  );
}
