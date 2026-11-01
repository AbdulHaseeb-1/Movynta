import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { describeApproval } from "./approvalPreview";

interface ApprovalCardProps {
  preview: Record<string, unknown>;
  onDecide: (decision: "approve" | "reject") => void;
}

/** Asks the user to approve or reject a batch of scene changes before they are applied. */
export function ApprovalCard({ preview, onDecide }: ApprovalCardProps) {
  const { summary, commands } = describeApproval(preview);
  return (
    <section
      className="flex animate-in flex-col gap-3 rounded-2xl bg-foreground/[0.06] p-3.5 duration-300 fade-in slide-in-from-bottom-2 motion-reduce:animate-none"
      aria-label="Approval required"
    >
      <header className="flex flex-col gap-0.5">
        <h3 className="text-[13px] font-medium">Apply these changes?</h3>
        <p className="text-xs leading-snug text-muted-foreground">{summary}</p>
      </header>
      {commands.length > 0 && (
        <ScrollArea className="max-h-32">
          <ul className="flex flex-col gap-1.5 text-xs">
            {commands.map((command, index) => (
              <li key={command.id} className="flex gap-2 text-foreground/90">
                <span className="w-4 shrink-0 text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 break-words">{command.text}</span>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" onClick={() => onDecide("approve")}>
          <Check className="size-3.5" /> Approve
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onDecide("reject")}
        >
          <X className="size-3.5" /> Reject
        </Button>
      </div>
    </section>
  );
}
