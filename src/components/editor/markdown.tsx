"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

const components: Components = {
  h1: ({ node: _n, ...p }) => (
    <h1 className="mt-6 mb-3 text-[24px] font-semibold tracking-tight first:mt-0" {...p} />
  ),
  h2: ({ node: _n, ...p }) => (
    <h2 className="mt-6 mb-2 text-[18px] font-semibold tracking-tight first:mt-0" {...p} />
  ),
  h3: ({ node: _n, ...p }) => <h3 className="mt-5 mb-2 text-[15px] font-semibold first:mt-0" {...p} />,
  p: ({ node: _n, ...p }) => <p className="my-2.5 leading-relaxed" {...p} />,
  a: ({ node: _n, ...p }) => (
    <a
      className="text-primary underline underline-offset-2 hover:opacity-80"
      target="_blank"
      rel="noreferrer"
      {...p}
    />
  ),
  ul: ({ node: _n, className, ...p }) => (
    <ul
      className={cn(
        "my-2.5 flex flex-col gap-1 pl-5",
        className?.includes("contains-task-list") ? "list-none pl-1" : "list-disc",
      )}
      {...p}
    />
  ),
  ol: ({ node: _n, ...p }) => <ol className="my-2.5 flex list-decimal flex-col gap-1 pl-5" {...p} />,
  li: ({ node: _n, className, ...p }) => (
    <li className={cn("pl-0.5", className?.includes("task-list-item") && "flex items-start gap-2")} {...p} />
  ),
  input: ({ node: _n, ...p }) => (
    <input {...p} disabled className="mt-1 size-3.5 shrink-0 accent-[var(--primary)]" />
  ),
  blockquote: ({ node: _n, ...p }) => (
    <blockquote className="my-3 border-l-2 pl-3 text-muted-foreground" {...p} />
  ),
  code: ({ node: _n, className, ...p }) =>
    className ? (
      <code className={cn("font-mono text-[12.5px]", className)} {...p} />
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12.5px]" {...p} />
    ),
  pre: ({ node: _n, ...p }) => (
    <pre className="my-3 overflow-x-auto rounded-md border bg-muted/50 p-3 font-mono text-[12.5px]" {...p} />
  ),
  hr: () => <hr className="my-5 border-border" />,
  table: ({ node: _n, ...p }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-[13px]" {...p} />
    </div>
  ),
  th: ({ node: _n, ...p }) => <th className="border-b px-2 py-1.5 text-left font-medium" {...p} />,
  td: ({ node: _n, ...p }) => <td className="border-b px-2 py-1.5" {...p} />,
};

/** Renders markdown (GitHub style: tables, checklists, strikethrough). Raw HTML is never rendered. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("text-[14px] text-foreground [overflow-wrap:anywhere]", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
