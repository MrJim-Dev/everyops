"use client";

import {
  CaretDownIcon,
  CheckIcon,
  CodeIcon,
  DesktopIcon,
  DeviceMobileIcon,
  DeviceTabletIcon,
  EyeIcon,
  FileArrowUpIcon,
  ImageIcon,
  PlugsConnectedIcon,
} from "@phosphor-icons/react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { HtmlPageFrame } from "@/components/public/html-page-frame";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { HtmlPageView as HtmlPageConfig } from "@/lib/blueprint/types";
import { formSnippet, MAX_HTML_BYTES, pageHtml } from "@/lib/public/html-page";
import { htmlPage, type PublicForm } from "@/lib/public/resolve";
import { canManage } from "@/lib/store/workspaces";
import { uploadImage } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { PublicBar } from "./public-bar";

const SAVE_DELAY = 800;
const PREVIEW_DELAY = 350;
const kb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1000))} KB`;

/** An icon option with its name for screen readers (and for the tooltip). */
function DeviceLabel({ Icon, name }: { Icon: typeof DesktopIcon; name: string }) {
  return (
    <span className="flex items-center" title={name}>
      <Icon className="size-4" aria-hidden />
      <span className="sr-only">{name}</span>
    </span>
  );
}

const DEVICES = [
  { value: "desktop", label: <DeviceLabel Icon={DesktopIcon} name="Desktop" />, width: "100%" },
  { value: "tablet", label: <DeviceLabel Icon={DeviceTabletIcon} name="Tablet" />, width: "820px" },
  { value: "phone", label: <DeviceLabel Icon={DeviceMobileIcon} name="Phone" />, width: "390px" },
] as const;

/**
 * A page designed entirely in HTML. In the app it fills the whole middle panel as a live preview; owners and
 * admins open the editor beside the preview. On the public site it is the whole page.
 */
export function HtmlPageView({ view }: { view: HtmlPageConfig }) {
  const ws = useWorkspace();
  const manager = canManage(ws.role);
  const saved = pageHtml(view, ws.docs);
  const forms = useMemo(
    () => htmlPage(ws.blueprint, ws.records, ws.docs, view).forms ?? [],
    [ws.blueprint, ws.records, ws.docs, view],
  );
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PublicBar view={view}>
        {manager ? (
          <Button size="sm" variant={editing ? "default" : "outline"} onClick={() => setEditing((e) => !e)}>
            {editing ? (
              <>
                <CheckIcon data-icon="inline-start" /> Done
              </>
            ) : (
              <>
                <CodeIcon data-icon="inline-start" /> Edit HTML
              </>
            )}
          </Button>
        ) : null}
      </PublicBar>
      {editing ? (
        <HtmlEditor key={view.id} view={view} saved={saved} forms={forms} />
      ) : (
        <HtmlPageFrame
          html={saved}
          slug={ws.id}
          forms={forms}
          preview
          title={view.name}
          className="min-h-0 w-full flex-1"
        />
      )}
    </div>
  );
}

function HtmlEditor({ view, saved, forms }: { view: HtmlPageConfig; saved: string; forms: PublicForm[] }) {
  const ws = useWorkspace();
  const [draft, setDraft] = useState(saved);
  const [shown, setShown] = useState(saved);
  const [device, setDevice] = useState<(typeof DEVICES)[number]["value"]>("desktop");
  const [pane, setPane] = useState<"code" | "preview">("code");
  const area = useRef<HTMLTextAreaElement>(null);
  const htmlFile = useRef<HTMLInputElement>(null);
  const picture = useRef<HTMLInputElement>(null);
  const bytes = useMemo(() => new TextEncoder().encode(draft).length, [draft]);
  const tooBig = bytes > MAX_HTML_BYTES;
  const latest = useRef({ draft, saved, tooBig, save: ws.saveDoc });
  latest.current = { draft, saved, tooBig, save: ws.saveDoc };

  // The preview follows the code a moment after typing stops; saving waits a little longer.
  useEffect(() => {
    const t = setTimeout(() => setShown(draft), PREVIEW_DELAY);
    return () => clearTimeout(t);
  }, [draft]);
  useEffect(() => {
    if (draft === saved || tooBig) return;
    const t = setTimeout(() => latest.current.save(view.id, draft), SAVE_DELAY);
    return () => clearTimeout(t);
  }, [draft, saved, tooBig, view.id]);
  // Closing the editor keeps the last keystrokes.
  useEffect(
    () => () => {
      const { draft, saved, tooBig, save } = latest.current;
      if (draft !== saved && !tooBig) save(view.id, draft);
    },
    [view.id],
  );

  const insert = (text: string) => {
    const el = area.current;
    const start = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + text + draft.slice(end);
    setDraft(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab" || e.shiftKey || e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    insert("  ");
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    const text = await file.text();
    if (new TextEncoder().encode(text).length > MAX_HTML_BYTES)
      return toast("That page is too large", {
        description: `Keep it under ${kb(MAX_HTML_BYTES)}. Host big images elsewhere or add them as pictures.`,
      });
    const before = draft;
    setDraft(text);
    toast.success(`Loaded ${file.name}`, { action: { label: "Undo", onClick: () => setDraft(before) } });
  };

  const addPicture = async (file: File | undefined) => {
    if (!file) return;
    try {
      const src = await uploadImage(file, ws);
      insert(`<img src="${src}" alt="" style="max-width:100%;height:auto">`);
    } catch (error) {
      toast("Couldn't add the picture", { description: (error as Error).message });
    }
  };

  const width = DEVICES.find((d) => d.value === device)?.width ?? "100%";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b px-3 py-2 lg:hidden">
        <SegmentedControl
          label="Show"
          value={pane}
          onValueChange={(v) => setPane(v as "code" | "preview")}
          options={[
            { value: "code", label: "Code" },
            { value: "preview", label: "Preview" },
          ]}
        />
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(380px,42%)_1fr]">
        <section
          aria-label="HTML"
          className={cn("min-h-0 flex-col border-r", pane === "code" ? "flex" : "hidden lg:flex")}
        >
          <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
            <input
              ref={htmlFile}
              type="file"
              accept=".html,.htm,text/html"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                void loadFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <input
              ref={picture}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/heic,image/heif,.heic,.heif"
              className="sr-only"
              tabIndex={-1}
              aria-hidden
              onChange={(e) => {
                void addPicture(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <Button size="sm" variant="ghost" onClick={() => htmlFile.current?.click()}>
              <FileArrowUpIcon data-icon="inline-start" />
              Upload .html
            </Button>
            <Button size="sm" variant="ghost" onClick={() => picture.current?.click()}>
              <ImageIcon data-icon="inline-start" />
              Picture
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
                <PlugsConnectedIcon data-icon="inline-start" />
                Connect a form
                <CaretDownIcon className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>Add a form that saves to</DropdownMenuLabel>
                  {forms.length ? (
                    forms.map((f) => (
                      <DropdownMenuItem key={f.viewId} onClick={() => insert(formSnippet(f))}>
                        {f.title}
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>
                      No public forms yet. Make a form public to collect bookings or sign-ups here.
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <span
              className={cn("ml-auto px-1 text-[12px]", tooBig ? "text-warning" : "text-muted-foreground")}
              aria-live="polite"
            >
              {tooBig
                ? `Too large to save: ${kb(bytes)} of ${kb(MAX_HTML_BYTES)}`
                : draft === saved
                  ? "Saved"
                  : "Saving…"}
            </span>
          </div>
          <textarea
            ref={area}
            aria-label={`${view.name} HTML`}
            value={draft}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            className="min-h-0 flex-1 resize-none bg-background p-4 font-mono text-[12.5px] leading-relaxed text-foreground outline-none"
          />
          <p className="border-t px-3 py-2 text-[11.5px] text-muted-foreground">
            Your page runs in a sandbox, apart from EveryOps. Forms save when they have
            <code className="mx-1 rounded bg-muted px-1">data-everyops-form</code>
            and inputs named after the form's fields. {kb(bytes)} of {kb(MAX_HTML_BYTES)}.
          </p>
        </section>
        <section
          aria-label="Preview"
          className={cn("min-h-0 flex-col bg-muted/40", pane === "preview" ? "flex" : "hidden lg:flex")}
        >
          <div className="flex items-center gap-2 border-b px-3 py-1.5">
            <EyeIcon className="size-4 text-muted-foreground" />
            <span className="flex-1 text-[12px] text-muted-foreground">Preview · forms don't save here</span>
            <SegmentedControl
              label="Preview size"
              value={device}
              onValueChange={(v) => setDevice(v as typeof device)}
              options={DEVICES.map((d) => ({ value: d.value, label: d.label }))}
            />
          </div>
          <div className="flex min-h-0 flex-1 justify-center overflow-auto p-3">
            <div
              className="h-full max-w-full overflow-hidden rounded-lg border bg-white shadow-sm transition-[width] duration-200"
              style={{ width }}
            >
              <HtmlPageFrame
                html={shown}
                slug={ws.id}
                forms={forms}
                preview
                title={`${view.name} preview`}
                className="h-full w-full"
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
