import { Circle, Globe, Layers2 } from "lucide-react";
import type { ReactNode } from "react";
import { useAppDispatch, useAppSelector } from "@/app/hooks";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { setShadingMode, setWireframeXray } from "./viewportSlice";

function MaterialIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="size-4" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 0 0 18V3Z" fill="currentColor" stroke="none" opacity="0.7" />
    <path d="M12 3v18M12 12h9" />
  </svg>;
}

interface ShadingButtonProps {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}

function ShadingButton({ label, active, disabled = false, onClick, children }: ShadingButtonProps) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <Button type="button" variant="ghost" size="icon" aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}
        className={cn("size-7 rounded-full text-muted-foreground hover:text-foreground", active && "bg-accent text-accent-foreground hover:bg-accent")}>
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>;
}

export function ShadingMenu() {
  const dispatch = useAppDispatch();
  const { shadingMode, wireframeXray } = useAppSelector((state) => state.viewport);
  return <TooltipProvider delayDuration={200}>
    <div role="toolbar" aria-label="Viewport shading" className="flex h-8 shrink-0 items-center gap-0.5 rounded-full border border-border bg-card/95 p-0.5 shadow-xl">
      <ShadingButton label="Wireframe X-ray" active={shadingMode === "wireframe" && wireframeXray} disabled={shadingMode !== "wireframe"} onClick={() => dispatch(setWireframeXray(!wireframeXray))}>
        <Layers2 className="size-4" />
      </ShadingButton>
      <div aria-hidden="true" className="mx-0.5 h-4 w-px bg-border" />
      <ShadingButton label="Wireframe view" active={shadingMode === "wireframe"} onClick={() => dispatch(setShadingMode("wireframe"))}>
        <Globe className="size-4" />
      </ShadingButton>
      <ShadingButton label="Solid view" active={shadingMode === "solid"} onClick={() => dispatch(setShadingMode("solid"))}>
        <Circle className="size-4 fill-current" />
      </ShadingButton>
      <ShadingButton label="Default material view" active={shadingMode === "default"} onClick={() => dispatch(setShadingMode("default"))}>
        <MaterialIcon />
      </ShadingButton>
    </div>
  </TooltipProvider>;
}
