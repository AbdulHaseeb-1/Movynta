import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** A plain scroll container. Scrollbars are hidden app-wide in `styles/index.css`. */
function ScrollArea({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="scroll-area"
      className={cn("overflow-y-auto overscroll-contain", className)}
      {...props}
    />
  );
}

export { ScrollArea };
