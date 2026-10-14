"use client";

import "@mdxeditor/editor/style.css";
import {
  BlockTypeSelect,
  BoldItalicUnderlineToggles,
  CodeToggle,
  CreateLink,
  codeBlockPlugin,
  codeMirrorPlugin,
  DiffSourceToggleWrapper,
  diffSourcePlugin,
  headingsPlugin,
  InsertCodeBlock,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  imagePlugin,
  ListsToggle,
  linkDialogPlugin,
  linkPlugin,
  listsPlugin,
  MDXEditor,
  type MDXEditorMethods,
  markdownShortcutPlugin,
  quotePlugin,
  Separator,
  StrikeThroughSupSubToggles,
  tablePlugin,
  thematicBreakPlugin,
  toolbarPlugin,
  UndoRedo,
} from "@mdxeditor/editor";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { uploadImage } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import type { MarkdownEditorProps } from "./markdown-editor";

const LANGUAGES = {
  "": "Plain text",
  txt: "Plain text",
  js: "JavaScript",
  ts: "TypeScript",
  json: "JSON",
  css: "CSS",
  html: "HTML",
  sql: "SQL",
  bash: "Shell",
  md: "Markdown",
};

export function MdxEditorInner({
  value,
  onChange,
  label,
  placeholder,
  autoFocus,
  className,
  minHeight = 320,
}: MarkdownEditorProps) {
  const ws = useWorkspace();
  const editor = useRef<MDXEditorMethods>(null);
  // The last markdown this editor produced, so outside changes (another note, a reload) are loaded in.
  const emitted = useRef(value);
  const workspace = useRef({ mode: ws.mode, id: ws.id });
  workspace.current = { mode: ws.mode, id: ws.id };

  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      editor.current?.setMarkdown(value);
    }
  }, [value]);

  const plugins = useMemo(
    () => [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      tablePlugin(),
      imagePlugin({
        imageUploadHandler: async (file: File) => {
          try {
            return await uploadImage(file, workspace.current);
          } catch (error) {
            toast.error((error as Error).message);
            throw error;
          }
        },
      }),
      codeBlockPlugin({ defaultCodeBlockLanguage: "" }),
      codeMirrorPlugin({ codeBlockLanguages: LANGUAGES }),
      diffSourcePlugin({ viewMode: "rich-text" }),
      markdownShortcutPlugin(),
      toolbarPlugin({
        toolbarClassName: "eo-mdx-toolbar",
        toolbarContents: () => (
          <DiffSourceToggleWrapper options={["rich-text", "source"]}>
            <UndoRedo />
            <Separator />
            <BlockTypeSelect />
            <BoldItalicUnderlineToggles />
            <StrikeThroughSupSubToggles options={["Strikethrough"]} />
            <CodeToggle />
            <Separator />
            <ListsToggle />
            <Separator />
            <CreateLink />
            <InsertImage />
            <InsertTable />
            <InsertCodeBlock />
            <InsertThematicBreak />
          </DiffSourceToggleWrapper>
        ),
      }),
    ],
    [],
  );

  const words = value.trim() ? value.trim().split(/\s+/).length : 0;

  return (
    <div className={cn("eo-mdx flex min-h-0 flex-col rounded-lg border bg-background", className)}>
      <MDXEditor
        ref={editor}
        markdown={value}
        onChange={(md, initialNormalize) => {
          // MDXEditor tidies the markdown when it first loads; that isn't an edit, so it isn't saved.
          if (initialNormalize) return;
          emitted.current = md;
          onChange(md);
        }}
        onError={({ error }) => console.warn("Markdown editor:", error)}
        plugins={plugins}
        autoFocus={autoFocus}
        placeholder={placeholder ?? "Start writing…"}
        className="dark-theme"
        contentEditableClassName="eo-mdx-content"
        spellCheck
        aria-label={label}
      />
      <style>{`.eo-mdx .eo-mdx-content{min-height:${minHeight}px}`}</style>
      <div className="flex items-center justify-between border-t px-3 py-1.5 text-[11.5px] text-muted-foreground">
        <span>Type ## for a heading, - for a list, [] for a checklist, or use the toolbar.</span>
        <span className="tabular">
          {words} {words === 1 ? "word" : "words"}
        </span>
      </div>
    </div>
  );
}
