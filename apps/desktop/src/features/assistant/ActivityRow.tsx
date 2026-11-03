import { useState } from "react";
import { Check, ChevronRight, CircleAlert, LoaderCircle } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { CaptureGallery } from "@/features/viewCapture";
import type { ActivityStep } from "./types";

function formatDuration(durationMs: number): string {
  return durationMs < 1000
    ? `${Math.round(durationMs)} ms`
    : `${(durationMs / 1000).toFixed(1)} s`;
}

function StatusGlyph({ status }: { status: ActivityStep["status"] }) {
  return (
    <span
      key={status}
      className="grid size-4 shrink-0 animate-in place-items-center duration-200 fade-in zoom-in-50 motion-reduce:animate-none"
    >
      {status === "running" ? (
        <LoaderCircle
          className="size-3.5 animate-spin motion-reduce:animate-none"
          aria-label="In progress"
        />
      ) : status === "failed" ? (
        <CircleAlert className="size-3.5 text-foreground" aria-label="Failed" />
      ) : (
        <Check className="size-3.5" aria-label="Done" />
      )}
    </span>
  );
}

/** One inline tool call or agent action. Steps with extra detail expand smoothly on click. */
export function StepRow({ step }: { step: ActivityStep }) {
  const hasDetail = Boolean(step.detail);
  const [override, setOverride] = useState<boolean | undefined>(undefined);
  const open = hasDetail && (override ?? step.status === "failed");

  return (
    <Collapsible
      open={open}
      onOpenChange={setOverride}
      className="animate-in duration-300 fade-in slide-in-from-bottom-1 motion-reduce:animate-none"
    >
      <CollapsibleTrigger
        disabled={!hasDetail}
        className="group flex w-full items-center gap-2 rounded-md py-1 text-left text-[12.5px] text-muted-foreground transition-colors outline-none focus-visible:text-foreground enabled:hover:text-foreground disabled:cursor-default"
      >
        <StatusGlyph status={step.status} />
        <span
          className={cn(
            "min-w-0 truncate",
            step.status === "running" && "text-shimmer",
          )}
        >
          {step.label}
        </span>
        {step.durationMs !== undefined && (
          <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
            {formatDuration(step.durationMs)}
          </span>
        )}
        {hasDetail && (
          <ChevronRight
            className={cn(
              "size-3 shrink-0 opacity-0 transition-[transform,opacity] duration-200 group-hover:opacity-100 group-focus-visible:opacity-100",
              open && "rotate-90 opacity-100",
            )}
          />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
        <p className="pb-1.5 pl-6 text-xs leading-relaxed break-words text-muted-foreground">
          {step.detail}
        </p>
      </CollapsibleContent>
      {step.captureId && <CaptureGallery captureId={step.captureId} />}
    </Collapsible>
  );
}

/** Shown once the agent has started answering, so the wait before that is not lost. */
export function ThinkingNote({ thinkingMs }: { thinkingMs: number }) {
  if (thinkingMs < 1000) return null;
  return (
    <p className="animate-in py-1 text-[12.5px] text-muted-foreground/70 duration-300 fade-in motion-reduce:animate-none">
      Thought for {Math.round(thinkingMs / 1000)}s
    </p>
  );
}

/** A shimmering label for work that has no visible output yet. */
export function PendingIndicator({ label }: { label: string }) {
  return (
    <output className="block animate-in py-1 text-[12.5px] duration-300 fade-in motion-reduce:animate-none">
      <span className="text-shimmer">{label}</span>
    </output>
  );
}
