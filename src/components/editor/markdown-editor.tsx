"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name for the editing area. */
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  minHeight?: number;
};

// MDXEditor works on the live page (Lexical needs the DOM), so it loads in the browser only.
const Inner = dynamic(() => import("./mdx-editor-inner").then((m) => m.MdxEditorInner), {
  ssr: false,
  loading: () => <Skeleton className="h-[320px] w-full rounded-lg" />,
});

/**
 * Rich markdown editor (MDXEditor): what you see is formatted as you type, with a toolbar for headings, lists,
 * checklists, links, tables, code and pictures, and a source view for the raw markdown. The value stays markdown.
 */
export function MarkdownEditor(props: MarkdownEditorProps) {
  return <Inner {...props} className={cn(props.className)} />;
}
