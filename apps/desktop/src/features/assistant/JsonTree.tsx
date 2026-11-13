import { ChevronRight } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/** Branches shallower than this start open; deeper ones start folded, so a large result stays readable. */
const OPEN_DEPTH = 2;

interface JsonTreeProps {
  value: unknown;
  /** The key, or the index, this value sits under. Nothing for the top level. */
  name?: string | undefined;
  /** True when `name` is an array index rather than an object key. */
  indexed?: boolean | undefined;
  depth?: number | undefined;
}

function isBranch(value: unknown): value is unknown[] | Record<string, unknown> {
  return Array.isArray(value) || (typeof value === "object" && value !== null);
}

/**
 * A JSON value as a readable tree: objects and arrays fold open and shut, strings keep their line breaks, and each kind
 * of value has its own weight, so the structure reads at a glance without any extra colour.
 */
export function JsonTree({ value, name, indexed = false, depth = 0 }: JsonTreeProps) {
  if (isBranch(value)) return <Branch value={value} name={name} indexed={indexed} depth={depth} />;
  return <Leaf value={value} name={name} indexed={indexed} />;
}

function KeyLabel({ name, indexed }: { name: string; indexed: boolean }) {
  return indexed ? (
    <span className="shrink-0 text-muted-foreground/70 tabular-nums">{name}</span>
  ) : (
    <span className="shrink-0 font-medium text-foreground">{name}:</span>
  );
}

function Scalar({ value }: { value: unknown }) {
  if (typeof value === "string") return <span className="min-w-0 break-words text-foreground/80">{JSON.stringify(value)}</span>;
  if (typeof value === "number") return <span className="tabular-nums text-foreground">{String(value)}</span>;
  if (typeof value === "boolean") return <span className="text-foreground">{String(value)}</span>;
  return <span className="text-muted-foreground italic">null</span>;
}

function Leaf({ value, name, indexed }: { value: unknown; name?: string | undefined; indexed: boolean }) {
  // A string with line breaks, such as a skill's instructions, keeps its layout in a block of its own.
  if (typeof value === "string" && value.includes("\n")) {
    return (
      <div className="py-0.5">
        {name !== undefined && <KeyLabel name={name} indexed={indexed} />}
        <pre className="mt-1 max-h-96 overflow-auto rounded-lg bg-background/70 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed break-words whitespace-pre-wrap text-foreground/85">
          {value}
        </pre>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 py-0.5">
      {name !== undefined && <KeyLabel name={name} indexed={indexed} />}
      <Scalar value={value} />
    </div>
  );
}

function Branch({
  value,
  name,
  indexed,
  depth,
}: {
  value: unknown[] | Record<string, unknown>;
  name?: string | undefined;
  indexed: boolean;
  depth: number;
}) {
  const isArray = Array.isArray(value);
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.map((item: unknown, index: number): [string, unknown] => [String(index), item])
    : Object.entries(value);
  const open = isArray ? "[" : "{";
  const close = isArray ? "]" : "}";
  const noun = isArray ? "item" : "field";
  const count = `${entries.length} ${entries.length === 1 ? noun : `${noun}s`}`;

  if (entries.length === 0) {
    return (
      <div className="flex flex-wrap items-baseline gap-x-2 py-0.5">
        {name !== undefined && <KeyLabel name={name} indexed={indexed} />}
        <span className="text-muted-foreground">
          {open}
          {close}
        </span>
      </div>
    );
  }

  return (
    <Collapsible defaultOpen={depth < OPEN_DEPTH} className="py-0.5">
      <CollapsibleTrigger className="group flex w-full items-baseline gap-x-2 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight
          aria-hidden
          className="size-3 shrink-0 translate-y-px self-center text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-90"
        />
        {name !== undefined && <KeyLabel name={name} indexed={indexed} />}
        <span className="text-muted-foreground">{open}</span>
        <span className={cn("text-[11px] text-muted-foreground/70", "group-data-[state=open]:hidden")}>
          {count} {close}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down motion-reduce:animate-none">
        <div className="mt-0.5 ml-[5px] border-l border-border pl-3">
          {entries.map(([key, child]) => (
            <JsonTree key={key} name={key} indexed={isArray} value={child} depth={depth + 1} />
          ))}
        </div>
        <div className="text-muted-foreground">{close}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
