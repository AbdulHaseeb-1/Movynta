import { Box, Bot, Shapes, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Suggestion {
  label: string;
  prompt: string;
  icon: LucideIcon;
}

const SUGGESTIONS: readonly Suggestion[] = [
  {
    label: "Friendly robot",
    prompt: "A friendly robot with a glowing orange antenna",
    icon: Bot,
  },
  {
    label: "Low-poly tree",
    prompt: "A low-poly pine tree built from cylinders and spheres",
    icon: Shapes,
  },
  {
    label: "Stacked crates",
    prompt: "Three wooden crates stacked in a pyramid",
    icon: Box,
  },
];

interface PromptSuggestionsProps {
  onPick: (prompt: string) => void;
}

/** Starter prompts shown under the empty prompt box. */
export function PromptSuggestions({ onPick }: PromptSuggestionsProps) {
  return (
    <ul
      className="pointer-events-auto flex flex-wrap items-center justify-center gap-2"
      aria-label="Prompt ideas"
    >
      {SUGGESTIONS.map(({ label, prompt, icon: Icon }) => (
        <li key={label}>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="rounded-full bg-foreground/[0.07] text-muted-foreground backdrop-blur-md hover:bg-foreground/[0.13] hover:text-foreground"
            onClick={() => onPick(prompt)}
          >
            <Icon className="size-3.5" /> {label}
          </Button>
        </li>
      ))}
    </ul>
  );
}
