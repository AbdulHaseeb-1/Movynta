import { useState } from "react";
import { Brain, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EFFORT_HINTS,
  EFFORT_LABELS,
  reasoningEffortSchema,
} from "./reasoningEfforts";
import { useReasoningEffort } from "./useReasoningEffort";

const AUTO = "auto";

/** Picks how hard the model reasons. Only shown for models that expose an effort setting. */
export function EffortSelector({ disabled }: { disabled: boolean }) {
  const { efforts, effort, failed, setEffort } = useReasoningEffort();
  const [open, setOpen] = useState(false);
  if (failed)
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled
        title="Could not load the reasoning effort options. If the backend was updated, restart it."
        className="gap-1.5 px-2 text-xs text-muted-foreground"
      >
        <Brain className="size-3.5" />
        <span>Effort unavailable</span>
      </Button>
    );
  if (efforts.length === 0) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          title="Reasoning effort"
          className="animate-in gap-1.5 px-2 text-xs text-muted-foreground duration-300 fade-in hover:bg-foreground/10 hover:text-foreground motion-reduce:animate-none"
        >
          <Brain className="size-3.5" />
          <span>{effort ? EFFORT_LABELS[effort] : "Auto"}</span>
          <ChevronDown className="size-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        className="w-60 p-1.5"
        collisionPadding={12}
      >
        <DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={effort ?? AUTO}
          onValueChange={(value) => {
            const parsed = reasoningEffortSchema.safeParse(value);
            setEffort(parsed.success ? parsed.data : null);
          }}
        >
          <DropdownMenuRadioItem value={AUTO}>
            <span>Auto</span>
            <span className="text-[11px] text-muted-foreground">
              Use the model&apos;s own default
            </span>
          </DropdownMenuRadioItem>
          {efforts.map((level) => (
            <DropdownMenuRadioItem key={level} value={level}>
              <span>{EFFORT_LABELS[level]}</span>
              <span className="text-[11px] text-muted-foreground">
                {EFFORT_HINTS[level]}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
