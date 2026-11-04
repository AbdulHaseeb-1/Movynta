import type { ComponentKind } from "./workspaceSlice";

/** A mesh outline with the selectable part highlighted. */
export function MeshSelectionIcon({ kind }: { kind: ComponentKind }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="1.5"
        fill={kind === "face" ? "currentColor" : "none"}
        fillOpacity={kind === "face" ? 0.85 : undefined}
        stroke="currentColor"
        strokeOpacity={kind === "face" ? 1 : 0.45}
        strokeWidth="1.3"
      />
      {kind === "vertex" && (
        <rect x="1" y="1" width="4" height="4" rx="0.5" fill="currentColor" />
      )}
      {kind === "edge" && (
        <path
          d="M13.5 3v10"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
