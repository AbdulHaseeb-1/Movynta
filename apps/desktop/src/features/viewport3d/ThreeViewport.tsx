import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { createViewport, type Viewport } from "./viewport";

export type ViewportSetup = (viewport: Viewport) => void | (() => void);

export interface ThreeViewportProps {
  className?: string | undefined;
  children?: ReactNode;
  onReady?: ViewportSetup;
}

// Hosts a Three.js viewport above which `children` are rendered. `onReady` runs once per mount with the viewport
// so the parent can add objects to `viewport.scene`. A function it returns runs on unmount, before disposal.
export function ThreeViewport({ className, children, onReady }: ThreeViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const viewport = createViewport(container);
    const teardown = onReadyRef.current?.(viewport);
    return () => {
      if (typeof teardown === "function") teardown();
      viewport.dispose();
    };
  }, []);

  return (
    <div ref={containerRef} className={cn("relative h-full w-full overflow-hidden [&>canvas]:block", className)}>
      {children}
    </div>
  );
}
