import { Box } from "lucide-react";
import { cn } from "@/lib/utils";

interface ProjectThumbnailProps {
  className?: string;
}

/** A quiet placeholder for a project: a dotted canvas with a centered cube. */
export function ProjectThumbnail({
  className,
}: ProjectThumbnailProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none relative grid h-24 place-items-center overflow-hidden bg-muted/70",
        className,
      )}
      style={{
        backgroundImage:
          "radial-gradient(color-mix(in oklab, var(--foreground) 16%, transparent) 1px, transparent 1px)",
        backgroundSize: "14px 14px",
      }}
    >
      <Box className="size-8 text-foreground/80" strokeWidth={1.4} />
    </div>
  );
}
