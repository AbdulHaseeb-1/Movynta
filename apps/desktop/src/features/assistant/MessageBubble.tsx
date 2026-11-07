import { CircleAlert, RotateCcw, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MessageAttachments } from "../attachments/MessageAttachments";
import { PendingIndicator, StepRow, ThinkingNote } from "./ActivityRow";
import { CopyButton } from "./CopyButton";
import { Markdown } from "./Markdown";
import { buildParts } from "./messageParts";
import type { ChatMessage } from "./types";

interface MessageBubbleProps {
  message: ChatMessage;
  /** Set on the latest reply so it can offer a retry. */
  onRetry?: (() => void) | undefined;
}

function UserMessage({ message }: { message: ChatMessage }) {
  return (
    <div className="flex animate-in flex-col items-end gap-1.5 duration-300 fade-in slide-in-from-bottom-2 motion-reduce:animate-none">
      {message.attachments && <MessageAttachments attachments={message.attachments} />}
      <p className="max-w-[88%] rounded-2xl bg-foreground/[0.08] px-3.5 py-2 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {message.content}
      </p>
    </div>
  );
}

function AssistantMessage({ message, onRetry }: MessageBubbleProps) {
  const streaming = message.state === "streaming";
  const parts = buildParts(message);
  const last = parts[parts.length - 1];
  const waiting = streaming && (last === undefined || (last.kind === "step" && last.step.status !== "running"));

  return (
    <div className="flex min-w-0 flex-col">
      {message.thinkingMs !== undefined && <ThinkingNote thinkingMs={message.thinkingMs} />}
      {parts.map((part) =>
        part.kind === "text" ? (
          <div key={part.id} className="animate-in duration-300 fade-in motion-reduce:animate-none">
            <Markdown>{part.text}</Markdown>
          </div>
        ) : (
          <StepRow key={part.id} step={part.step} />
        ),
      )}
      {waiting && <PendingIndicator label={parts.length === 0 ? "Thinking" : "Working"} />}
      {message.error && (
        <div
          className="mt-2 flex animate-in items-start gap-2 rounded-xl bg-foreground/[0.06] px-3 py-2.5 text-xs text-foreground duration-300 fade-in motion-reduce:animate-none"
          role="alert"
        >
          <CircleAlert className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0 break-words">{message.error}</span>
        </div>
      )}
      {message.state === "cancelled" && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Ban className="size-3.5" /> Stopped before finishing
        </p>
      )}
      {!streaming && (message.content || onRetry) && (
        <div className="mt-1.5 -ml-1.5 flex animate-in items-center gap-0.5 duration-300 fade-in motion-reduce:animate-none">
          {message.content && <CopyButton text={message.content} label="Copy reply" />}
          {onRetry && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={onRetry}
                  aria-label="Try again"
                >
                  <RotateCcw className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Try again</TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
}

/** One message in the chat: the user's text with its pictures, or an assistant reply with its steps. */
export function MessageBubble({ message, onRetry }: MessageBubbleProps) {
  return message.role === "user" ? (
    <UserMessage message={message} />
  ) : (
    <AssistantMessage message={message} onRetry={onRetry} />
  );
}
