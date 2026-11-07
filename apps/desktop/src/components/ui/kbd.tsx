import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

/** One key cap, such as Ctrl or Z. */
function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded border border-border bg-muted px-1.5 font-sans text-[11px] leading-none font-medium text-foreground shadow-[inset_0_-1px_0_var(--border)] select-none",
        className,
      )}
      {...props}
    />
  );
}

/** Key caps pressed together or in sequence. */
function KbdGroup({ className, ...props }: ComponentProps<"span">) {
  return <span data-slot="kbd-group" className={cn("inline-flex flex-wrap items-center gap-1", className)} {...props} />;
}

export { Kbd, KbdGroup };
