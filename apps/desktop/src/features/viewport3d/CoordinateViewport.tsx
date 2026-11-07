import { useEffect, useRef, type ReactNode } from "react";
import type { Group } from "three";
import { addCoordinateSpace, anchorToOrigin, updateCoordinateSpace } from "./coordinateSpace";
import { ThreeViewport } from "./ThreeViewport";
import type { Viewport } from "./viewport";

/** The props of the viewport component. */
export interface CoordinateViewportProps {
  className?: string | undefined;
  children?: ReactNode;
  showGrid?: boolean;
  onReady?: (viewport: Viewport) => void;
}

// A transparent 3D viewport showing the coordinate grid. `children` are centered on the origin, where the two
// highlighted lines cross, and stay there while the view orbits, zooms, or pans.
// Drag to orbit, scroll to zoom, and right-drag, Space + drag, or two-finger drag to pan.
export function CoordinateViewport({ className, children, showGrid = true, onReady }: CoordinateViewportProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<Group | null>(null);

  useEffect(() => {
    if (gridRef.current) gridRef.current.visible = showGrid;
  }, [showGrid]);

  const handleReady = (viewport: Viewport) => {
    const grid = addCoordinateSpace(viewport.scene);
    grid.visible = showGrid;
    gridRef.current = grid;
    onReady?.(viewport);
    const updateGrid = () => updateCoordinateSpace(grid, viewport.controls.target, viewport.controls.getDistance());
    updateGrid();
    const stopGrid = viewport.addFrameListener(updateGrid);
    const anchor = anchorRef.current;
    const stopAnchor = anchor ? anchorToOrigin(viewport, anchor) : undefined;
    return () => {
      stopGrid();
      stopAnchor?.();
      gridRef.current = null;
    };
  };

  return (
    <ThreeViewport className={className} onReady={handleReady}>
      <div
        ref={anchorRef}
        className="pointer-events-none absolute top-0 left-0 w-max -translate-x-1/2 -translate-y-1/2"
      >
        {children}
      </div>
    </ThreeViewport>
  );
}
