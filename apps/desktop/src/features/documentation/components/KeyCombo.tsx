import { Fragment } from "react";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";
import { parseKeyGroups, type KeyAlternative, type KeyPart, type KeyStep } from "../shortcuts/keys";

interface KeyComboProps {
  /** Key text in the grammar of `shortcuts/keys.ts`, such as "Ctrl+Shift+Z / Ctrl+Y". */
  readonly keys: string;
  readonly className?: string | undefined;
}

function partText(part: KeyPart): string {
  return part.kind === "key" ? part.key : part.action;
}

function stepText(step: KeyStep): string {
  return step.map(partText).join("+");
}

function alternativeText(alternative: KeyAlternative): string {
  return alternative.kind === "label" ? alternative.text : alternative.steps.map(stepText).join(" then ");
}

function Separator({ text }: { readonly text: string }) {
  return <span className="text-[11px] text-muted-foreground">{text}</span>;
}

function Step({ step }: { readonly step: KeyStep }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {step.map((part, index) => (
        <Fragment key={partText(part)}>
          {index > 0 && <Separator text="+" />}
          {part.kind === "key" ? (
            <Kbd>{part.key}</Kbd>
          ) : (
            <span className="text-[11px] font-medium text-foreground/85">{part.action}</span>
          )}
        </Fragment>
      ))}
    </span>
  );
}

function Alternative({ alternative }: { readonly alternative: KeyAlternative }) {
  if (alternative.kind === "label")
    return <span className="text-[11px] text-muted-foreground">{alternative.text}</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {alternative.steps.map((step, index) => (
        <Fragment key={stepText(step)}>
          {index > 0 && <Separator text="then" />}
          <Step step={step} />
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Draws key text as key caps: "Ctrl+B" becomes two caps, "/" separates alternatives, "·" separates groups,
 * and words that are not keys, such as "Mesh menu", stay plain text. Screen readers hear the original text.
 */
export function KeyCombo({ keys, className }: KeyComboProps) {
  const groups = parseKeyGroups(keys);
  return (
    <KbdGroup className={cn("gap-x-1.5", className)}>
      <span className="sr-only">{keys}</span>
      {groups.map((group, groupIndex) => (
        <Fragment key={group.map(alternativeText).join(" / ")}>
          {groupIndex > 0 && (
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
          )}
          <span aria-hidden className="inline-flex flex-wrap items-center justify-[inherit] gap-1">
            {group.map((alternative, index) => (
              <Fragment key={alternativeText(alternative)}>
                {index > 0 && <Separator text="/" />}
                <Alternative alternative={alternative} />
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </KbdGroup>
  );
}
