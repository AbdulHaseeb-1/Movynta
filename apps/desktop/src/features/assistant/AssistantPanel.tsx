import { useCallback, useRef, useState, type ReactNode } from "react";
import { ArrowDown, SquarePen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { ApprovalCard } from "./ApprovalCard";
import { ASSISTANT_NAME, LOGO_SRC } from "./branding";
import { MessageBubble } from "./MessageBubble";
import type { AssistantRun } from "./useAssistantRun";

/** Distance from the bottom, in px, within which new content keeps the view pinned to the end. */
const STICK_THRESHOLD = 48;

function HeaderButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
          onClick={onClick}
          disabled={disabled}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

interface AssistantPanelProps {
  run: AssistantRun;
  onNewChat: () => void;
  className?: string;
  /** The message composer, shown pinned to the bottom of the pane. */
  composer?: ReactNode;
  /** Open shows the full pane; closed shows only the logo launcher it grows out of. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Conversation pane: transcript with inline tool calls, approvals, and the composer. */
export function AssistantPanel({
  run,
  onNewChat,
  className,
  composer,
  open,
  onOpenChange,
}: AssistantPanelProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const [atBottom, setAtBottom] = useState(true);
  const { messages, approvals } = run;
  const pending = approvals.filter((approval) => approval.status === "pending");

  /** Keeps the newest content in view as replies stream in, unless the reader scrolled up. */
  const followContent = useCallback((content: HTMLDivElement | null) => {
    if (!content) return undefined;
    const observer = new ResizeObserver(() => {
      const element = viewport.current;
      if (element && pinned.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  function scrollToEnd() {
    viewport.current?.scrollTo({
      top: viewport.current.scrollHeight,
      behavior: "smooth",
    });
  }

  return (
    <TooltipProvider delayDuration={300}>
      <aside
        id="assistant-panel"
        className={cn("pointer-events-none flex flex-col", className)}
        aria-label={ASSISTANT_NAME}
      >
        {/* One dark glass surface that grows out of the launcher button and shrinks back into it. */}
        <Card
          className={cn(
            "pointer-events-auto relative min-h-0 gap-0 overflow-hidden border-0 bg-black/60 p-0 text-card-foreground shadow-2xl backdrop-blur-2xl backdrop-saturate-150",
            "transition-[width,height,border-radius] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none",
            open
              ? "h-full w-[min(400px,calc(100vw-32px))] rounded-3xl"
              : "h-10 w-10 rounded-xl",
          )}
        >
          <div
            className={cn(
              "absolute top-0 left-0 grid size-10 place-items-center transition-opacity duration-200 ease-in-out motion-reduce:transition-none",
              open ? "pointer-events-none opacity-0" : "opacity-100 delay-300",
            )}
            inert={open}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-10 rounded-xl hover:bg-foreground/10"
                  aria-label={`Open ${ASSISTANT_NAME}`}
                  aria-expanded={open}
                  aria-controls="assistant-panel"
                  onClick={() => onOpenChange(true)}
                >
                  <img
                    src={LOGO_SRC}
                    alt=""
                    draggable={false}
                    className="size-5 object-contain"
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                Open {ASSISTANT_NAME}
              </TooltipContent>
            </Tooltip>
          </div>
          {/* Fixed width so the content never reflows while the surface resizes. */}
          <div
            className={cn(
              "absolute top-0 left-0 flex h-full w-[min(400px,calc(100vw-32px))] flex-col transition-opacity duration-300 ease-in-out motion-reduce:transition-none",
              open ? "opacity-100 delay-200" : "pointer-events-none opacity-0",
            )}
            inert={!open}
          >
            <header className="flex h-14 shrink-0 items-center gap-2.5 pr-3 pl-5">
              <img
                src={LOGO_SRC}
                alt=""
                draggable={false}
                className="h-5 w-auto shrink-0 select-none"
              />
              <h2 className="min-w-0 flex-1 truncate text-[14px] font-medium tracking-tight">
                {ASSISTANT_NAME}
              </h2>
              <HeaderButton
                label="New chat"
                onClick={onNewChat}
                disabled={run.busy}
              >
                <SquarePen className="size-3.5" />
              </HeaderButton>
              <HeaderButton
                label={`Close ${ASSISTANT_NAME}`}
                onClick={() => onOpenChange(false)}
              >
                <X className="size-4" />
              </HeaderButton>
            </header>
            <div className="relative min-h-0 flex-1">
              <ScrollArea
                className="h-full [mask-image:linear-gradient(to_bottom,transparent,black_20px,black_calc(100%-20px),transparent)]"
                ref={viewport}
                onScroll={(event) => {
                  const element = event.target;
                  if (!(element instanceof HTMLElement)) return;
                  const near =
                    element.scrollHeight -
                      element.scrollTop -
                      element.clientHeight <
                    STICK_THRESHOLD;
                  pinned.current = near;
                  setAtBottom(near);
                }}
              >
                <div
                  ref={followContent}
                  className="flex flex-col gap-6 px-5 py-5"
                  role="log"
                  aria-live="polite"
                  aria-label="Conversation"
                >
                  {messages.length === 0 && (
                    <div className="flex min-h-48 animate-in flex-col items-center justify-center gap-3 text-center duration-500 fade-in motion-reduce:animate-none">
                      <img
                        src={LOGO_SRC}
                        alt=""
                        draggable={false}
                        className="h-8 w-auto opacity-80 select-none"
                      />
                      <p className="text-[13px] text-muted-foreground">
                        Describe what you want to create.
                      </p>
                    </div>
                  )}
                  {messages.map((message, index) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      onRetry={
                        run.canRetry &&
                        message.role === "assistant" &&
                        index === messages.length - 1
                          ? run.retry
                          : undefined
                      }
                    />
                  ))}
                </div>
              </ScrollArea>
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                className={cn(
                  "absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full shadow-lg transition-[opacity,transform] duration-200 motion-reduce:transition-none",
                  atBottom
                    ? "pointer-events-none translate-y-2 opacity-0"
                    : "opacity-100",
                )}
                onClick={scrollToEnd}
                aria-label="Scroll to latest"
                tabIndex={atBottom ? -1 : 0}
              >
                <ArrowDown className="size-3.5" />
              </Button>
            </div>
            {pending.length > 0 && (
              <div className="flex max-h-[40%] shrink-0 flex-col gap-2 overflow-y-auto px-4 pb-2">
                {pending.map((approval) => (
                  <ApprovalCard
                    key={approval.id}
                    preview={approval.preview}
                    onDecide={(decision) =>
                      void run.decide(approval.id, decision)
                    }
                  />
                ))}
              </div>
            )}
            {composer && (
              <div className="shrink-0 px-4 pt-1 pb-4">{composer}</div>
            )}
          </div>
        </Card>
      </aside>
    </TooltipProvider>
  );
}
