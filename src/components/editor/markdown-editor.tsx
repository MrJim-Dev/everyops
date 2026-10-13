"use client";

import {
  CheckSquareIcon,
  CodeIcon,
  LinkSimpleIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  MinusIcon,
  QuotesIcon,
  TextBIcon,
  TextHTwoIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Markdown } from "./markdown";

export type EditorMode = "write" | "split" | "preview";

/**
 * Replaces part of the textarea through the browser's own text input, so ⌘Z undo keeps working and React
 * sees a normal change event.
 */
function replace(
  ta: HTMLTextAreaElement,
  start: number,
  end: number,
  text: string,
  select?: [number, number],
) {
  ta.focus();
  ta.setSelectionRange(start, end);
  if (!document.execCommand("insertText", false, text)) {
    ta.setRangeText(text, start, end, "end");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }
  if (select) ta.setSelectionRange(select[0], select[1]);
}

/** Wraps the selection in markers (bold, italic…), or removes them if they're already there. */
function wrap(ta: HTMLTextAreaElement, marker: string, placeholder: string) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const selected = value.slice(s, e);
  const m = marker.length;
  if (value.slice(s - m, s) === marker && value.slice(e, e + m) === marker) {
    replace(ta, s - m, e + m, selected, [s - m, e - m]);
    return;
  }
  const inner = selected || placeholder;
  replace(ta, s, e, marker + inner + marker, [s + m, s + m + inner.length]);
}

const LIST = /^(\s*)(- \[[ x]\] |[-*+] |\d+\. |> )/;

/** Adds a prefix to every selected line (headings, lists, quotes), or removes it when all lines have it. */
function prefixLines(ta: HTMLTextAreaElement, make: (i: number) => string, test: RegExp) {
  const { selectionStart: s, selectionEnd: e, value } = ta;
  const from = value.lastIndexOf("\n", s - 1) + 1;
  const nl = value.indexOf("\n", e);
  const to = nl === -1 ? value.length : nl;
  const lines = value.slice(from, to).split("\n");
  const all = lines.every((l) => test.test(l));
  const next = lines.map((l, i) =>
    all ? l.replace(test, "") : make(i) + l.replace(LIST, "$1").replace(/^#{1,6} /, ""),
  );
  const text = next.join("\n");
  // With nothing selected, keep typing after the new prefix; with a selection, keep the lines selected.
  replace(
    ta,
    from,
    to,
    text,
    s === e ? [from + text.length, from + text.length] : [from, from + text.length],
  );
}

type Action = { label: string; keys?: string; icon: ReactNode; run: (ta: HTMLTextAreaElement) => void };

const ACTIONS: (Action | "sep")[] = [
  { label: "Heading", icon: <TextHTwoIcon />, run: (ta) => prefixLines(ta, () => "## ", /^#{1,6} /) },
  { label: "Bold", keys: "⌘B", icon: <TextBIcon />, run: (ta) => wrap(ta, "**", "bold text") },
  { label: "Italic", keys: "⌘I", icon: <TextItalicIcon />, run: (ta) => wrap(ta, "_", "italic text") },
  { label: "Strikethrough", icon: <TextStrikethroughIcon />, run: (ta) => wrap(ta, "~~", "text") },
  "sep",
  {
    label: "Bulleted list",
    icon: <ListBulletsIcon />,
    run: (ta) => prefixLines(ta, () => "- ", /^- (?!\[)/),
  },
  {
    label: "Numbered list",
    icon: <ListNumbersIcon />,
    run: (ta) => prefixLines(ta, (i) => `${i + 1}. `, /^\d+\. /),
  },
  {
    label: "Checklist",
    icon: <CheckSquareIcon />,
    run: (ta) => prefixLines(ta, () => "- [ ] ", /^- \[[ x]\] /),
  },
  { label: "Quote", icon: <QuotesIcon />, run: (ta) => prefixLines(ta, () => "> ", /^> /) },
  "sep",
  { label: "Code", keys: "⌘E", icon: <CodeIcon />, run: (ta) => wrap(ta, "`", "code") },
  {
    label: "Link",
    icon: <LinkSimpleIcon />,
    run: (ta) => {
      const { selectionStart: s, selectionEnd: e, value } = ta;
      const label = value.slice(s, e) || "link text";
      const text = `[${label}](https://)`;
      replace(ta, s, e, text, [s + label.length + 3, s + text.length - 1]);
    },
  },
  {
    label: "Divider",
    icon: <MinusIcon />,
    run: (ta) => {
      const { selectionStart: s, value } = ta;
      const before = s > 0 && value[s - 1] !== "\n" ? "\n\n" : "\n";
      replace(ta, s, s, `${before}---\n\n`);
    },
  },
];

/** Enter continues a list item; Enter on an empty item ends the list. Tab and Shift+Tab indent list lines. */
function onEditorKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  const ta = e.currentTarget;
  const mod = e.metaKey || e.ctrlKey;
  if (mod && !e.shiftKey && !e.altKey) {
    const key = e.key.toLowerCase();
    const run = key === "b" ? ACTIONS[1] : key === "i" ? ACTIONS[2] : key === "e" ? ACTIONS[9] : undefined;
    if (run && run !== "sep") {
      e.preventDefault();
      run.run(ta);
      return;
    }
  }
  const { selectionStart: s, selectionEnd: end, value } = ta;
  const from = value.lastIndexOf("\n", s - 1) + 1;
  const line = value.slice(from, s);
  const match = line.match(LIST);
  if (e.key === "Enter" && !e.shiftKey && !mod && s === end && match) {
    e.preventDefault();
    if (line === match[0]) {
      replace(ta, from, s, "");
      return;
    }
    const [, indent, marker] = match;
    const num = marker.match(/^(\d+)\. /);
    const nextMarker = num ? `${Number(num[1]) + 1}. ` : marker.startsWith("- [") ? "- [ ] " : marker;
    replace(ta, s, s, `\n${indent}${nextMarker}`);
    return;
  }
  if (e.key === "Tab" && match) {
    e.preventDefault();
    if (e.shiftKey) {
      if (line.startsWith("  ")) replace(ta, from, from + 2, "");
    } else replace(ta, from, from, "  ");
  }
}

/**
 * Markdown editor: a toolbar and shortcuts over a plain textarea, with a live preview beside it or instead
 * of it. The text is markdown, so it reads well anywhere it's shown.
 */
export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Start writing…",
  mode: initialMode = "write",
  autoFocus,
  label,
  className,
  minHeight = 320,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mode?: EditorMode;
  autoFocus?: boolean;
  label: string;
  className?: string;
  minHeight?: number;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<EditorMode>(initialMode);

  useEffect(() => {
    if (autoFocus) ta.current?.focus();
  }, [autoFocus]);

  // Grow with the text so the page scrolls, not a box inside it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text or layout changes
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`;
  }, [value, mode, minHeight]);

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  return (
    <div className={cn("flex min-h-0 flex-col rounded-lg border bg-background", className)}>
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 rounded-t-lg border-b bg-background/95 px-1.5 py-1 backdrop-blur">
        {ACTIONS.map((a, i) =>
          a === "sep" ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed toolbar
            <span key={i} aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
          ) : (
            <button
              key={a.label}
              type="button"
              aria-label={a.label}
              title={a.keys ? `${a.label} (${a.keys})` : a.label}
              disabled={mode === "preview"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => ta.current && a.run(ta.current)}
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color,transform] duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.94] disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4"
            >
              {a.icon}
            </button>
          ),
        )}
        <div
          role="radiogroup"
          aria-label="Editor layout"
          className="ml-auto flex items-center rounded-md bg-muted p-0.5"
        >
          {(["write", "split", "preview"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                "h-6 rounded px-2 text-[12px] capitalize text-muted-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50",
                m === "split" && "hidden lg:block",
                mode === m && "bg-background text-foreground shadow-sm",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <div className={cn("grid min-h-0 flex-1", mode === "split" && "lg:grid-cols-2 lg:divide-x")}>
        <textarea
          ref={ta}
          aria-label={label}
          value={value}
          placeholder={placeholder}
          spellCheck
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onEditorKey}
          className={cn(
            "w-full resize-none bg-transparent px-4 py-3 font-mono text-[13.5px] leading-relaxed outline-none placeholder:text-muted-foreground/60",
            mode === "preview" && "hidden",
          )}
        />
        {mode !== "write" ? (
          <div className={cn("min-w-0 px-5 py-3", mode === "split" && "hidden lg:block")}>
            {value.trim() ? (
              <Markdown>{value}</Markdown>
            ) : (
              <p className="text-[13px] text-muted-foreground">Nothing to preview yet.</p>
            )}
          </div>
        ) : null}
      </div>
      <div className="flex items-center justify-between border-t px-3 py-1.5 text-[11.5px] text-muted-foreground">
        <span>Markdown: **bold**, _italic_, - lists, - [ ] tasks, ## headings</span>
        <span className="tabular">
          {words} {words === 1 ? "word" : "words"}
        </span>
      </div>
    </div>
  );
}
