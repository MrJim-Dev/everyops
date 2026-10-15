"use client";

import {
  CaretDownIcon,
  CheckIcon,
  CodeIcon,
  DatabaseIcon,
  DesktopIcon,
  DeviceMobileIcon,
  DeviceTabletIcon,
  EyeIcon,
  FileArrowUpIcon,
  ImageIcon,
  PlugsConnectedIcon,
  ShareNetworkIcon,
  UploadSimpleIcon,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { sharedFields, sharedTableProblems } from "@/lib/components/public-safety";
import { CONTACT_SNIPPET, listSnippet, MENU_SNIPPET, recordSnippet } from "@/lib/public/bindings";
import { formSnippet, MAX_HTML_BYTES, pageHtml } from "@/lib/public/html-page";
import { publicTableData, workspaceTableData } from "@/lib/public/page-data";
import { htmlPage, isPublic, type PublicPageData, renderedHtml } from "@/lib/public/resolve";
import { canManage, useWorkspaces } from "@/lib/store/workspaces";
import { uploadImage } from "@/lib/uploads";
import { cn } from "@/lib/utils";
import { HtmlCodeEditor, type HtmlCodeEditorHandle } from "./html-code-editor";
import { PageVersions } from "./page-versions";
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
  // What visitors see: the page with its live parts drawn from the workspace's current data.
  const page = useMemo(
    () => htmlPage(ws.blueprint, ws.records, ws.docs, view, ws.name),
    [ws.blueprint, ws.records, ws.docs, view, ws.name],
  );
  const [editing, setEditing] = useState(false);
  // Public pages read what visitors would (published sources and shared tables); private pages read table views.
  const readData = (id: string) =>
    view.public
      ? publicTableData(ws.blueprint, ws.records, id)
      : workspaceTableData(ws.blueprint, ws.records, id);

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
        <HtmlEditor key={view.id} view={view} saved={saved} page={page} readData={readData} />
      ) : (
        <HtmlPageFrame
          pickable
          html={page.html ?? saved}
          slug={ws.id}
          forms={page.forms ?? []}
          readData={readData}
          live={page.live}
          site={page.site}
          pageId={view.id}
          preview={ws.mode === "preview"}
          title={view.name}
          className="min-h-0 w-full flex-1"
        />
      )}
    </div>
  );
}

function HtmlEditor({
  view,
  saved,
  page,
  readData,
}: {
  view: HtmlPageConfig;
  saved: string;
  page: PublicPageData;
  readData: (id: string) => unknown;
}) {
  const ws = useWorkspace();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const forms = page.forms ?? [];
  const [draft, setDraft] = useState(saved);
  const [shown, setShown] = useState(saved);
  const [device, setDevice] = useState<(typeof DEVICES)[number]["value"]>("desktop");
  const [pane, setPane] = useState<"code" | "preview">("code");
  const area = useRef<HtmlCodeEditorHandle>(null);
  const htmlFile = useRef<HTMLInputElement>(null);
  const picture = useRef<HTMLInputElement>(null);
  const bytes = useMemo(() => new TextEncoder().encode(draft).length, [draft]);
  // The preview fills the live parts and shared parts (includes) from the workspace too, as visitors will see them.
  const liveShown = useMemo(
    () => renderedHtml(ws.blueprint, ws.records, ws.docs, view, shown),
    [ws.blueprint, ws.records, ws.docs, view, shown],
  );
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

  const insert = (text: string) => area.current?.insert(text);
  // Pictures already uploaded for this workspace's pages, newest first, so one upload serves every page.
  const pictures = useMemo(() => {
    const re = new RegExp(`/api/files/${ws.id}/[0-9a-f-]{36}\\.(?:png|jpg|gif|webp)`, "g");
    const texts = [
      draft,
      ...Object.values(ws.docs).map((d) => d.body),
      ...ws.blueprint.views.map((v) => (v.type === "html" ? (v.html ?? "") : "")),
    ];
    return [...new Set(texts.flatMap((t) => t.match(re) ?? []))].slice(0, 24);
  }, [draft, ws.docs, ws.blueprint.views, ws.id]);

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

  // What this page may read: published layouts and landing pages, tables shared as public data (or, on a private
  // page, any table view), and a website's own sections.
  const tables = ws.blueprint.views.filter((v) => v.type === "table");
  const fieldsOf = (id: string) => {
    const v = ws.blueprint.views.find((x) => x.id === id);
    if (v?.type !== "table") return [];
    if (view.public) return sharedFields(ws.blueprint, v).map((f) => ({ id: f.id, name: f.name }));
    const entity = ws.blueprint.entities.find((e) => e.id === v.entityId);
    return v.fieldIds
      .flatMap((fid) => entity?.fields.filter((f) => f.id === fid) ?? [])
      .map((f) => ({ id: f.id, name: f.name }));
  };
  const sources = [
    ...(page.live ? [{ id: "page", name: "This page's sections" }] : []),
    ...ws.blueprint.views.filter(
      (v) =>
        ((v.type === "layout" || v.type === "landing") && isPublic(v)) ||
        (v.type === "table" && (!view.public || v.publicData)),
    ),
  ];
  const shareable = view.public
    ? tables.filter(
        (v) =>
          v.type === "table" &&
          !v.publicData &&
          !sharedTableProblems(ws.blueprint, { ...v, publicData: true }).length,
      )
    : [];
  const shared = view.public ? tables.filter((v) => v.type === "table" && v.publicData) : [];
  const share = (id: string, name: string, on: boolean) => {
    const entry = applyChange(ws.id, {
      request: `${on ? "Share" : "Stop sharing"} ${name} ${on ? "as public data" : "publicly"}`,
      title: on ? `Share ${name} with public pages` : `Stop sharing ${name}`,
      facts: [],
      steps: [
        {
          kind: "change",
          label: name,
          detail: on ? "Team only → Shared with public pages" : "Shared → Team only",
        },
      ],
      ops: [{ op: "update_view", viewId: id, patch: { public: on } }],
    });
    if (!entry) return;
    if (on) {
      insert(listSnippet(id, fieldsOf(id).length ? fieldsOf(id) : []));
      toast.success(`${name} is shared with public pages`, {
        description: "Only its fields that don't identify people or show costs are shared.",
      });
    } else toast.success(`${name} is no longer shared`);
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
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
                <ImageIcon data-icon="inline-start" />
                Picture
                <CaretDownIcon className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-[70vh] w-80 overflow-y-auto">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => picture.current?.click()}>
                    <UploadSimpleIcon />
                    Upload a picture…
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                {pictures.length ? (
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>
                      Already in your pages (hosted, not counted in the page size)
                    </DropdownMenuLabel>
                    <div className="grid grid-cols-4 gap-1.5 px-1.5 pb-1.5">
                      {pictures.map((src) => (
                        <DropdownMenuItem
                          key={src}
                          className="aspect-square p-0"
                          aria-label="Insert this picture"
                          onClick={() =>
                            insert(`<img src="${src}" alt="" style="max-width:100%;height:auto">`)
                          }
                        >
                          {/* biome-ignore lint/performance/noImgElement: a small preview of an upload */}
                          <img src={src} alt="" className="size-full rounded bg-white object-cover" />
                        </DropdownMenuItem>
                      ))}
                    </div>
                  </DropdownMenuGroup>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
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
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
                <DatabaseIcon data-icon="inline-start" />
                Connect data
                <CaretDownIcon className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-[70vh] w-80 overflow-y-auto">
                <DropdownMenuGroup>
                  <DropdownMenuLabel>A list that stays current, from</DropdownMenuLabel>
                  {sources.length ? (
                    sources.map((source) => (
                      <DropdownMenuItem
                        key={source.id}
                        onClick={() => insert(listSnippet(source.id, fieldsOf(source.id)))}
                      >
                        {source.name}
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>
                      Share a table below, or publish a layout, to show its records here.
                    </DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                {sources.some((s) => fieldsOf(s.id).length) ? (
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>One record (for /{view.id}/record-id)</DropdownMenuLabel>
                    {sources
                      .filter((s) => fieldsOf(s.id).length)
                      .map((source) => (
                        <DropdownMenuItem
                          key={source.id}
                          onClick={() => insert(recordSnippet(source.id, view.id, fieldsOf(source.id)))}
                        >
                          {source.name}
                        </DropdownMenuItem>
                      ))}
                  </DropdownMenuGroup>
                ) : null}
                <DropdownMenuGroup>
                  <DropdownMenuLabel>From the site</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => insert(MENU_SNIPPET)}>
                    Menu of published pages
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => insert(CONTACT_SNIPPET)}>Contact details</DropdownMenuItem>
                  {ws.blueprint.views
                    .filter((v) => v.type === "html" && v.id !== view.id && !v.public)
                    .map((v) => (
                      <DropdownMenuItem
                        key={v.id}
                        onClick={() => insert(`<div data-everyops-include="${v.id}"></div>`)}
                      >
                        Shared part: {v.name}
                      </DropdownMenuItem>
                    ))}
                </DropdownMenuGroup>
                {canManage(ws.role) && (shareable.length || shared.length) ? (
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Share a table with public pages</DropdownMenuLabel>
                    {shareable.map((v) => (
                      <DropdownMenuItem key={v.id} onClick={() => share(v.id, v.name, true)}>
                        <ShareNetworkIcon />
                        Share {v.name}
                      </DropdownMenuItem>
                    ))}
                    {shared.map((v) => (
                      <DropdownMenuItem key={v.id} onClick={() => share(v.id, v.name, false)}>
                        Stop sharing {v.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            <PageVersions workspaceId={ws.id} pageKey={view.id} current={draft} onRestore={setDraft} />
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
          <HtmlCodeEditor ref={area} label={`${view.name} HTML`} value={draft} onChange={setDraft} />
          <p className="border-t px-3 py-2 text-[11.5px] text-muted-foreground">
            Your page runs in a sandbox, apart from EveryOps. Forms save when they have
            <code className="mx-1 rounded bg-muted px-1">data-everyops-form</code>
            and inputs named after the form's fields. Connect data adds lists that fill themselves from your
            records. {kb(bytes)} of {kb(MAX_HTML_BYTES)}.
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
                pickable
                html={liveShown}
                slug={ws.id}
                forms={forms}
                readData={readData}
                live={page.live}
                site={page.site}
                pageId={view.id}
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
