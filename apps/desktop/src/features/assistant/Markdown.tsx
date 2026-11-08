import { isValidElement, memo, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { cn } from "@/lib/utils";
import { CopyButton } from "./CopyButton";

function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children) ? children.props : undefined;
  const language = /language-([\w-]+)/.exec(code?.className ?? "")?.[1];
  const text = textOf(code?.children ?? children).replace(/\n$/, "");
  return (
    <div className="my-3 overflow-hidden rounded-xl bg-foreground/[0.05]">
      <div className="flex h-8 items-center justify-between pr-1 pl-3">
        <span className="font-mono text-[11px] text-muted-foreground">{language ?? "text"}</span>
        <CopyButton text={text} label="Copy code" />
      </div>
      <pre className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed">
        <code>{text}</code>
      </pre>
    </div>
  );
}

/** Whether a link from a reply is one to open: only web addresses are, never a script or a path in the app. */
export function isOpenableLink(href: string | undefined): href is string {
  return href !== undefined && /^https?:\/\//i.test(href);
}

/** A link in a reply. It opens in the system browser, never inside the app's webview. */
export function Link({ href, children }: ComponentProps<"a">) {
  const safe = isOpenableLink(href);
  // The Tauri webview cannot open new windows, so hand links to the OS browser.
  function open() {
    if (safe) void openUrl(href).catch(() => window.open(href, "_blank"));
  }
  return (
    <a
      href={safe ? href : undefined}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-foreground underline decoration-foreground/30 underline-offset-2 hover:decoration-foreground"
      onClick={(event) => {
        event.preventDefault();
        open();
      }}
      // A middle click does not send "click", but would still ask the webview for a new window of its own.
      onAuxClick={(event) => {
        event.preventDefault();
        if (event.button === 1) open();
      }}
    >
      {children}
    </a>
  );
}

const components: Components = {
  p: ({ children }) => <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>,
  h1: ({ children }) => <h3 className="mt-4 mb-2 text-[15px] font-semibold tracking-tight first:mt-0">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 mb-2 text-[14px] font-semibold tracking-tight first:mt-0">{children}</h3>,
  h3: ({ children }) => <h4 className="mt-3 mb-1.5 text-[13px] font-semibold first:mt-0">{children}</h4>,
  h4: ({ children }) => <h4 className="mt-3 mb-1.5 text-[13px] font-semibold first:mt-0">{children}</h4>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5 marker:text-muted-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5 leading-relaxed">{children}</li>,
  a: Link,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="my-3 border-l-2 border-foreground/30 pl-3 text-muted-foreground">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  pre: CodeBlock,
  code: ({ className, children }) => (
    <code className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]", className)}>{children}</code>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-xl bg-foreground/[0.04]">
      <table className="w-full border-collapse text-left text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-foreground/[0.05]">{children}</thead>,
  tr: ({ children }) => <tr className="border-t border-foreground/[0.06] first:border-0">{children}</tr>,
  th: ({ children }) => <th className="px-3 py-2 font-medium">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2">{children}</td>,
};

/** Renders a model reply as GitHub-flavoured markdown. Raw HTML is never rendered. */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="text-[13.5px] break-words text-foreground/90">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
