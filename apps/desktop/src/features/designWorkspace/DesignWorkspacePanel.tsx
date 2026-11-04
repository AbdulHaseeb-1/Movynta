import { Layers3 } from "lucide-react";
import type { EditorScene } from "@/features/assistant";
import { WorkspacePanel } from "@/components/WorkspacePanel";
import type { SerialQueue } from "@/lib";
import { SceneOutliner } from "./SceneOutliner";

interface DesignWorkspacePanelProps {
  scene: EditorScene | null;
  saves: SerialQueue;
  disabled: boolean;
}

export function DesignWorkspacePanel({ scene, saves, disabled }: DesignWorkspacePanelProps) {
  return (
    <div className="pointer-events-auto w-full space-y-3">
      <WorkspacePanel panelId="scene" label="scene" icon={Layers3}>
        <SceneOutliner scene={scene} saves={saves} disabled={disabled} />
      </WorkspacePanel>
    </div>
  );
}
