import { useState } from "react";
import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { errorMessage } from "@/lib/backend";
import { describeApproval } from "./approvalPreview";

interface ApprovalCardProps {
  preview: Record<string, unknown>;
  /** Resolves once the backend has taken the decision, which removes the card; rejects when it did not. */
  onDecide: (decision: "approve" | "reject") => Promise<void>;
}

/** Asks the user to approve or reject a batch of scene changes before they are applied. */
export function ApprovalCard({ preview, onDecide }: ApprovalCardProps) {
  const { summary, commands } = describeApproval(preview);
  // Both buttons wait while a decision is on its way, so a second click cannot send it twice.
  const [deciding, setDeciding] = useState(false);
  const [failure, setFailure] = useState("");
  async function decide(decision: "approve" | "reject") {
    if (deciding) return;
    setDeciding(true);
    setFailure("");
    try {
      await onDecide(decision);
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setDeciding(false);
    }
  }
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
      {failure && (
        <p role="alert" className="text-xs break-words text-muted-foreground">
          {failure}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" disabled={deciding} onClick={() => void decide("approve")}>
          <Check className="size-3.5" /> Approve
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={deciding}
          onClick={() => void decide("reject")}
        >
          <X className="size-3.5" /> Reject
        </Button>
      </div>
    </section>
  );
}
