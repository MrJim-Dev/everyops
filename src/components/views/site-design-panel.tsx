"use client";

import { PaletteIcon, XIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { HtmlPageView } from "@/lib/blueprint/types";
import { designOf, redesignSite, THEMES } from "@/lib/public/custom-site";
import { REFERENCES, SECTION_STYLES, type SectionKind, type SiteDesign } from "@/lib/public/site-sections";
import { useWorkspaces } from "@/lib/store/workspaces";

const KIND_NAMES: Record<SectionKind, string> = {
  nav: "Top bar",
  hero: "Hero",
  highlights: "Highlights",
  offer: "What you offer",
  steps: "How it works",
  payments: "Ways to pay",
  faq: "Questions",
  contact: "Contact",
  closing: "Closing banner",
  footer: "Footer",
  booking: "Booking page",
};

/** Opens the website design panel. */
export function SiteDesignButton({ onOpen }: { onOpen: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onOpen}>
      <PaletteIcon data-icon="inline-start" /> Design
    </Button>
  );
}

/**
 * The website's design beside its preview: a theme, a starting point from the reference sites, and a style for every
 * section. Changes show in the preview at once (from the workspace's live data) and save as one change the owner can
 * undo.
 */
export function SiteDesignPanel({
  view,
  onPreview,
  onClose,
}: {
  view: HtmlPageView;
  /** The page drawn in the draft design; null when the panel closes. */
  onPreview: (html: string | null) => void;
  onClose: () => void;
}) {
  const ws = useWorkspace();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const undoChange = useWorkspaces((s) => s.undoChange);
  const saved = useMemo(() => designOf(ws.blueprint, view), [ws.blueprint, view]);
  const [draft, setDraft] = useState<SiteDesign>(saved);
  const edited = !!ws.docs[view.id]?.body;

  const show = (next: SiteDesign) => {
    setDraft(next);
    onPreview(redesignSite(ws.blueprint, ws.records, ws.docs, view, next).html);
  };
  const close = () => {
    onPreview(null);
    onClose();
  };
  const save = () => {
    const out = redesignSite(ws.blueprint, ws.records, ws.docs, view, draft);
    const booking = out.booking && ws.blueprint.views.find((v) => v.id === out.booking?.viewId);
    const changed = (Object.keys(SECTION_STYLES) as SectionKind[]).filter((k) => draft[k] !== saved[k]);
    const entry = applyChange(ws.id, {
      request: `Change the design of ${view.name}`,
      title: `Redesign ${view.name}`,
      facts: [],
      steps: [
        {
          kind: "change",
          label: view.name,
          detail:
            [
              ...(draft.theme !== saved.theme ? [`Theme: ${draft.theme ?? "automatic"}`] : []),
              ...changed.map(
                (k) => `${KIND_NAMES[k]}: ${SECTION_STYLES[k].find((s) => s.id === draft[k])?.label}`,
              ),
            ].join(", ") || "Same design, drawn again",
        },
      ],
      ops: [
        {
          op: "replace_view",
          viewId: view.id,
          view: { ...view, html: out.html, live: { blocks: view.live?.blocks ?? [], design: { ...draft } } },
        },
        ...(out.booking && booking?.type === "html"
          ? [
              {
                op: "replace_view" as const,
                viewId: booking.id,
                view: { ...booking, html: out.booking.html },
              },
            ]
          : []),
      ],
    });
    // Hand edits live in the page's text; the new design replaces them.
    if (edited) ws.saveDoc(view.id, out.html);
    if (out.booking && ws.docs[out.booking.viewId]?.body) ws.saveDoc(out.booking.viewId, out.booking.html);
    close();
    if (entry)
      toast.success("Website design saved", {
        description: "You can also undo it from History.",
        action: { label: "Undo", onClick: () => undoChange(ws.id, entry.id) },
      });
  };

  return (
    <aside aria-label="Website design" className="flex w-[300px] shrink-0 flex-col border-l bg-background">
      <div className="flex items-start gap-2 border-b px-4 py-3">
        <div className="flex-1">
          <h2 className="text-[13.5px] font-semibold">Website design</h2>
          <p className="text-[12px] text-muted-foreground">
            A style for each part. The preview uses your live data, and prices stay current in every style.
          </p>
        </div>
        <Button size="icon-sm" variant="ghost" aria-label="Close" onClick={close}>
          <XIcon />
        </Button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 text-[13px]">
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Start from</span>
          <NativeSelect
            aria-label="Start from a reference site"
            value=""
            onChange={(e) => {
              const ref = REFERENCES.find((r) => r.id === e.target.value);
              if (ref) show({ ...ref.design });
            }}
          >
            <NativeSelectOption value="">A reference site…</NativeSelectOption>
            {REFERENCES.map((r) => (
              <NativeSelectOption key={r.id} value={r.id}>
                {r.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-muted-foreground">Theme</span>
          <NativeSelect
            aria-label="Theme"
            value={draft.theme ?? ""}
            onChange={(e) => show({ ...draft, theme: e.target.value || undefined })}
          >
            <NativeSelectOption value="">Automatic</NativeSelectOption>
            {THEMES.map((t) => (
              <NativeSelectOption key={t.id} value={t.id}>
                {t.id[0].toUpperCase() + t.id.slice(1)} · {t.font}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>
        {(Object.keys(SECTION_STYLES) as SectionKind[]).map((kind) => (
          <div key={kind} className="flex flex-col gap-1">
            <span className="text-muted-foreground">{KIND_NAMES[kind]}</span>
            <NativeSelect
              aria-label={KIND_NAMES[kind]}
              value={draft[kind]}
              onChange={(e) => show({ ...draft, [kind]: e.target.value })}
              title={SECTION_STYLES[kind].find((s) => s.id === draft[kind])?.about}
            >
              {SECTION_STYLES[kind].map((s) => (
                <NativeSelectOption key={s.id} value={s.id}>
                  {s.label}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t px-4 py-3">
        {edited ? (
          <p className="text-[12px] text-muted-foreground">
            Saving replaces the edits you made in Edit HTML.
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={save}>Save design</Button>
        </div>
      </div>
    </aside>
  );
}
