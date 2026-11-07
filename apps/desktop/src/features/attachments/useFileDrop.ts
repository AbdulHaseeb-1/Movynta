import { useEffect, useRef, useState, type RefObject } from "react";
import { dragHasFiles } from "./imageFiles";

/**
 * Makes an element take files dropped on it, and says while a file is being dragged over it. Listeners are added
 * to the element itself, since dragenter and dragleave fire for every child the pointer crosses and so need a count.
 * `accepting` false still shows the drag, but refuses the drop, so the element can say why.
 */
export function useFileDrop(
  target: RefObject<HTMLElement | null>,
  accepting: boolean,
  onFiles: (files: File[]) => void,
): boolean {
  const [dragging, setDragging] = useState(false);
  // The listeners are added once. They read the latest settings from here, so a render in the middle of a drag
  // does not remove them and lose count of the elements the pointer has crossed.
  const latest = useRef({ accepting, onFiles });
  useEffect(() => {
    latest.current = { accepting, onFiles };
  });
  useEffect(() => {
    const element = target.current;
    if (!element) return undefined;
    let depth = 0;
    const enter = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      depth += 1;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer) || !event.dataTransfer) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = latest.current.accepting ? "copy" : "none";
    };
    const leave = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      if (!dragHasFiles(event.dataTransfer)) return;
      event.preventDefault();
      depth = 0;
      setDragging(false);
      if (latest.current.accepting && event.dataTransfer) latest.current.onFiles(Array.from(event.dataTransfer.files));
    };
    element.addEventListener("dragenter", enter);
    element.addEventListener("dragover", over);
    element.addEventListener("dragleave", leave);
    element.addEventListener("drop", drop);
    return () => {
      element.removeEventListener("dragenter", enter);
      element.removeEventListener("dragover", over);
      element.removeEventListener("dragleave", leave);
      element.removeEventListener("drop", drop);
    };
  }, [target]);
  return dragging;
}
