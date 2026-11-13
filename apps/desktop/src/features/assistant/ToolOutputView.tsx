import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/backend";
import { CopyButton } from "./CopyButton";
import { JsonTree } from "./JsonTree";
import { getToolOutput, type ToolOutputRecord } from "./toolOutputs";
import { copyText, describeShape, formatBytes, readToolText, textBytes } from "./toolOutputFormat";

type Load =
  | { readonly state: "loading" }
  | { readonly state: "failed"; readonly message: string }
  | { readonly state: "ready"; readonly record: ToolOutputRecord };

interface ToolOutputViewProps {
  runId: string;
  outputId: string;
}

/**
 * The full arguments and result of one tool call, opened from its step. Fetched when the step opens, so a long
 * result costs nothing until someone asks for it.
 */
export function ToolOutputView({ runId, outputId }: ToolOutputViewProps) {
  // Trying again remounts the loader with a new attempt number, which starts a fresh request.
  const [attempt, setAttempt] = useState(0);
  return (
    <div className="mb-2 ml-6 overflow-hidden rounded-xl border border-border bg-card animate-in duration-300 fade-in motion-reduce:animate-none">
      <OutputLoader
        key={attempt}
        runId={runId}
        outputId={outputId}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    </div>
  );
}

/** Fetches the record once, and shows it, or a message with a way to try again. */
function OutputLoader({ runId, outputId, onRetry }: ToolOutputViewProps & { onRetry: () => void }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void getToolOutput(runId, outputId, controller.signal).then(
      (record) => setLoad({ state: "ready", record }),
      (error: unknown) => {
        if (!controller.signal.aborted) setLoad({ state: "failed", message: errorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [runId, outputId]);

  if (load.state === "loading") return <LoadingLines />;
  if (load.state === "failed") {
    return (
      <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-xs text-muted-foreground">
        <span className="min-w-0 break-words">Could not load this step: {load.message}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  return <StoredOutput record={load.record} />;
}

/** Three bars that stand in for the output while it loads. */
function LoadingLines() {
  return (
    <output aria-label="Loading the step" className="block space-y-2 px-3 py-3">
      <span className="block h-2.5 w-2/3 animate-pulse rounded bg-foreground/[0.07]" />
      <span className="block h-2.5 w-1/2 animate-pulse rounded bg-foreground/[0.07]" />
      <span className="block h-2.5 w-5/12 animate-pulse rounded bg-foreground/[0.07]" />
    </output>
  );
}

/** The loaded record: its result or its request, with the size, the shape and a copy button. */
function StoredOutput({ record }: { record: ToolOutputRecord }) {
  const [side, setSide] = useState<"result" | "request">("result");
  const source = side === "result" ? record.output : record.input;
  const text = useMemo(() => readToolText(source), [source]);
  const size = side === "result" ? record.outputBytes : textBytes(record.input);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-2.5 py-2">
        <Tabs value={side} onValueChange={(value) => setSide(value === "request" ? "request" : "result")} className="gap-0">
          <TabsList className="h-7 p-0.5">
            <TabsTrigger value="result" className="h-6 px-2.5 text-[12px]">
              Result
            </TabsTrigger>
            <TabsTrigger value="request" className="h-6 px-2.5 text-[12px]">
              Request
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {formatBytes(size)} · {describeShape(text)}
        </span>
        <CopyButton text={copyText(text)} label={side === "result" ? "Copy result" : "Copy request"} className="ml-auto" />
      </div>

      <div className="max-h-96 overflow-y-auto overscroll-contain px-3.5 py-3">
        {text.kind === "json" ? (
          <div className="font-mono text-[12px] leading-relaxed">
            <JsonTree value={text.value} />
          </div>
        ) : text.text.trim() === "" ? (
          <p className="text-xs text-muted-foreground">Nothing was returned.</p>
        ) : (
          <pre className="font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap text-foreground/85">
            {text.text}
          </pre>
        )}
      </div>

      {record.truncated && side === "result" && (
        <p className="border-t border-border px-3.5 py-2 text-[11.5px] text-muted-foreground">
          The full result was {formatBytes(record.outputBytes)}. Only its first part is kept, so this view is cut short.
        </p>
      )}
    </>
  );
}
