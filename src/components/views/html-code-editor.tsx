"use client";

import { html } from "@codemirror/lang-html";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { basicSetup } from "codemirror";
import { type Ref, useEffect, useImperativeHandle, useRef } from "react";

export type HtmlCodeEditorHandle = { insert: (text: string) => void };

const colors = HighlightStyle.define([
  { tag: [tags.tagName, tags.typeName], color: "#7dd3fc" },
  { tag: [tags.attributeName, tags.propertyName], color: "#c4b5fd" },
  { tag: [tags.string, tags.attributeValue], color: "#a7f3d0" },
  { tag: [tags.keyword, tags.operator], color: "#f9a8d4" },
  { tag: [tags.number, tags.bool, tags.unit], color: "#fcd34d" },
  { tag: tags.comment, color: "#94a3b8", fontStyle: "italic" },
]);
const theme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "#101415", color: "#dce3e1", fontSize: "12.5px" },
    ".cm-scroller": { overflow: "auto", fontFamily: "var(--font-geist-mono), monospace", lineHeight: "1.7" },
    ".cm-content": { padding: "12px 0", caretColor: "#dce3e1" },
    ".cm-line": { padding: "0 12px" },
    ".cm-gutters": { backgroundColor: "#101415", color: "#71817d", borderRight: "1px solid #27312e" },
    ".cm-activeLineGutter, .cm-activeLine": { backgroundColor: "#1b2421" },
    "&.cm-focused": { outline: "none" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": { backgroundColor: "#334b45" },
    ".cm-cursor": { borderLeftColor: "#dce3e1" },
  },
  { dark: true },
);

/** One persistent editor preserves selection and history across autosaves and preview renders. */
export function HtmlCodeEditor({
  value,
  onChange,
  label,
  ref,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  ref?: Ref<HtmlCodeEditorHandle>;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);
  const latest = useRef({ value, onChange, label });
  latest.current = { value, onChange, label };
  useImperativeHandle(
    ref,
    () => ({
      insert(text) {
        const view = editor.current;
        if (!view) return;
        view.dispatch(view.state.replaceSelection(text), { scrollIntoView: true, userEvent: "input" });
        view.focus();
      },
    }),
    [],
  );
  useEffect(() => {
    if (!host.current) return;
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          basicSetup,
          html(),
          theme,
          syntaxHighlighting(colors),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": latest.current.label, spellcheck: "false" }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    editor.current = view;
    return () => {
      editor.current = null;
      view.destroy();
    };
  }, []);
  useEffect(() => {
    const view = editor.current;
    if (view && value !== view.state.doc.toString())
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);
  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" />;
}
