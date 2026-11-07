interface CodeBlockProps {
  readonly label: string;
  readonly text: string;
}

/** A read-only block of example code. Long lines scroll inside the block rather than widening the page. */
export function CodeBlock({ label, text }: CodeBlockProps) {
  return (
    <figure className="min-w-0">
      <figcaption className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </figcaption>
      <pre className="max-h-96 overflow-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs leading-5 text-foreground">
        {text}
      </pre>
    </figure>
  );
}
