import { useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { MousePointerClick, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { KeyCombo } from "../components/KeyCombo";

/** A hint shown beside an interactive example. */
export interface ExampleHint {
  /** Key text in the grammar of `shortcuts/keys.ts`. */
  readonly keys: string;
  readonly label: string;
}

/** The props of the frame that holds an interactive example. */
export interface ExampleFrameProps {
  readonly title: string;
  readonly hints: readonly ExampleHint[];
  /** The last thing that happened, read out to screen readers as it changes. */
  readonly status: string;
  readonly onReset: () => void;
  /** Keys reach the example only while its stage has focus, so the page keeps its own keys. */
  readonly onKeyDown?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
  readonly onKeyUp?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
  /** Called when the stage gains or loses focus, for example to cancel a preview. */
  readonly onFocusChange?: ((focused: boolean) => void) | undefined;
  readonly stageClassName?: string | undefined;
  /** Extra content under the hints, such as a note on how the example differs from the workspace. */
  readonly footnote?: ReactNode;
  readonly children: ReactNode;
}

/**
 * The shell of an interactive example: a focusable stage, the keys it understands, and a live status line.
 * Clicking the stage gives it the keyboard; Tab or a click elsewhere hands the keyboard back to the page.
 */
export function ExampleFrame({
  title,
  hints,
  status,
  onReset,
  onKeyDown,
  onKeyUp,
  onFocusChange,
  stageClassName,
  footnote,
  children,
}: ExampleFrameProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);
  const changeFocus = (next: boolean) => {
    setFocused(next);
    onFocusChange?.(next);
  };
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    changeFocus(false);
  };

  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Badge variant="accent" className="font-medium">
          Try it
        </Badge>
        <figcaption className="min-w-0 flex-1 truncate text-xs font-medium">{title}</figcaption>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-[11px] text-muted-foreground"
          onClick={() => {
            onReset();
            stageRef.current?.focus({ preventScroll: true });
          }}
        >
          <RotateCcw aria-hidden className="size-3" /> Reset
        </Button>
      </div>
      <div className="grid md:grid-cols-[minmax(0,1fr)_17rem]">
        {/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- The stage is a
            keyboard-driven canvas, like the workspace viewport. It holds its own controls (such as the gizmo), so it cannot be a button. */}
        <div
          ref={stageRef}
          role="application"
          aria-label={`${title}. Interactive example: focus it, then use the keys listed beside it.`}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onFocus={() => {
            if (!focused) changeFocus(true);
          }}
          onBlur={onBlur}
          onPointerDownCapture={() => stageRef.current?.focus({ preventScroll: true })}
          className={cn(
            "relative h-72 touch-none overflow-hidden bg-card outline-none select-none md:h-auto md:min-h-72",
            focused && "ring-1 ring-ring/50 ring-inset",
            stageClassName,
          )}
        >
          {children}
          {!focused && (
            <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-popover/90 px-3 py-1 text-[11px] text-muted-foreground shadow-lg">
                <MousePointerClick className="size-3.5" /> Click here to use the keys
              </span>
            </div>
          )}
        </div>
        {/* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */}
        <div className="flex flex-col gap-3 border-t border-border p-3 md:border-t-0 md:border-l">
          <ul className="space-y-1.5">
            {hints.map((hint) => (
              <li
                key={`${hint.keys}-${hint.label}`}
                className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-2"
              >
                <span className="pt-0.5 text-[11px] leading-4 text-muted-foreground">{hint.label}</span>
                <KeyCombo keys={hint.keys} className="justify-end" />
              </li>
            ))}
          </ul>
          {footnote && <div className="text-[11px] leading-4 text-muted-foreground">{footnote}</div>}
        </div>
      </div>
      <p
        aria-live="polite"
        className="min-h-9 border-t border-border bg-muted/50 px-3 py-2 font-mono text-[11px] leading-5 whitespace-pre-wrap text-foreground/90"
      >
        {status}
      </p>
    </figure>
  );
}
