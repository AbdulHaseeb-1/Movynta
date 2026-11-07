import { useEffect, useRef, useState } from "react";
import { Check, Copy, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

/** Copies text to the clipboard and confirms briefly with a check mark, or with a cross if the clipboard refused it. */
export function CopyButton({ text, label = "Copy", className }: CopyButtonProps) {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    let outcome: "copied" | "failed" = "copied";
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // The webview refuses clipboard access when it is not focused or the permission is denied.
      outcome = "failed";
    }
    setResult(outcome);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setResult(null), 1500);
  }

  const message = result === "copied" ? "Copied" : result === "failed" ? "Could not copy" : undefined;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-7 text-muted-foreground hover:text-foreground", className)}
          onClick={() => void copy()}
          aria-label={message ?? label}
        >
          {result === "copied" && <Check className="size-3.5 text-success" />}
          {result === "failed" && <X className="size-3.5 text-destructive" />}
          {result === null && <Copy className="size-3.5" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{message ?? label}</TooltipContent>
    </Tooltip>
  );
}
