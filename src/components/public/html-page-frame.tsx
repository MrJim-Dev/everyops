"use client";

import { useEffect, useMemo, useRef } from "react";
import { clip, kindOfTag } from "@/lib/assistant/picked";
import { useScreen } from "@/lib/assistant/screen-store";
import { itemsOf, type SiteDetails, sitePageItems, siteValues } from "@/lib/public/bindings";
import { withSiteLinks } from "@/lib/public/custom-site";
import { formValues, frameDocument, HTML_PAGE_SANDBOX, type RawFormValues } from "@/lib/public/html-page";
import type { PublicForm, ResolvedBlock } from "@/lib/public/resolve";
import { cn } from "@/lib/utils";

/** Keeps what a page sends to plain strings (or lists of them), and not too many or too long. */
function cleanValues(raw: unknown): RawFormValues {
  const out: RawFormValues = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw).slice(0, 200)) {
    if (typeof v === "string") out[k.slice(0, 100)] = v.slice(0, 4000);
    else if (Array.isArray(v)) out[k.slice(0, 100)] = v.filter((x) => typeof x === "string").slice(0, 50);
  }
  return out;
}

/** Add-ons a page sends: item id → a whole quantity from 1 to 99. The server still checks the form offers them. */
function cleanExtras(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw).slice(0, 40)) {
    const n = Math.floor(Number(v));
    if (Number.isFinite(n) && n > 0) out[k.slice(0, 100)] = Math.min(n, 99);
  }
  return out;
}

const str = (v: unknown, max = 100) => (typeof v === "string" ? v.slice(0, max) : "");

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  try {
    const res = await fetch(url, init);
    return (await res.json().catch(() => null)) ?? { ok: false, message: "Something went wrong. Try again." };
  } catch {
    return { ok: false, message: "You seem to be offline. Check your connection and try again." };
  }
}

/**
 * A custom HTML page in its sandbox, and the other end of its form bridge: a form the page sends is matched to one
 * of the workspace's public forms, converted to that form's fields, and posted to the same endpoint the built-in
 * form uses. A custom booking page also reads the form, free slots and days, and prices through it, from the same
 * public endpoints. Messages from anything but this frame are ignored. In previews nothing is saved or uploaded.
 */
export function HtmlPageFrame({
  html,
  slug,
  forms,
  preview,
  pickable,
  readData,
  live,
  site,
  pageId,
  recordId,
  title,
  className,
  customDomain = false,
}: {
  html: string;
  slug: string;
  forms: PublicForm[];
  preview?: boolean;
  /** In the workspace: parts of the page can be picked for the assistant (Pick from page). */
  pickable?: boolean;
  readData?: (viewId: string) => unknown;
  /** A website setup made: its own sections, answered locally as the "page" source. */
  live?: ResolvedBlock[];
  /** The business and its site, for site.* values and the site.pages menu. */
  site?: SiteDetails;
  /** This page's id (the menu marks it current) and the record id in its address (/s/site/page/RECORD). */
  pageId?: string;
  recordId?: string;
  title: string;
  className?: string;
  /** Served on the workspace's own domain: its links drop the /s/<workspace> prefix. */
  customDomain?: boolean;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  // Links the page was created with ("/s/<site>/book") point at this workspace's real pages.
  const doc = useMemo(
    () => frameDocument(withSiteLinks(html, slug, customDomain)),
    [html, slug, customDomain],
  );
  const latest = useRef({
    forms,
    preview,
    slug,
    readData,
    title,
    pickable,
    live,
    site,
    pageId,
    recordId,
    customDomain,
  });
  latest.current = {
    forms,
    preview,
    slug,
    readData,
    title,
    pickable,
    live,
    site,
    pageId,
    recordId,
    customDomain,
  };
  const picking = useScreen((s) => !!pickable && s.picking);
  const tellPicking = () => frame.current?.contentWindow?.postMessage({ everyops: "pick", on: picking }, "*");
  useEffect(tellPicking, [picking]);

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (!target || e.source !== target) return;
      const data = e.data as { everyops?: string; id?: unknown; form?: unknown; values?: unknown } | null;
      if (data?.everyops === "connect") {
        target.postMessage({ everyops: "ready" }, "*");
        return;
      }
      if (data?.everyops === "picked" || data?.everyops === "pick-cancel") {
        const screen = useScreen.getState();
        if (!latest.current.pickable || !screen.picking) return;
        if (data.everyops === "pick-cancel") return screen.setPicking(false);
        const p = e.data as Record<string, unknown>;
        const text = (v: unknown, max: number) => clip(typeof v === "string" ? v : "", max);
        const label = text(p.label, 80) || text(p.tag, 20);
        screen.addPicked({
          kind: kindOfTag(text(p.tag, 20)),
          label,
          path: [latest.current.title, text(p.path, 160)].filter(Boolean).join(" › "),
          ...(text(p.text, 300) && text(p.text, 300) !== label ? { text: text(p.text, 300) } : {}),
          ...(text(p.html, 1200) ? { html: text(p.html, 1200) } : {}),
        });
        return;
      }
      if ((data?.everyops !== "submit" && data?.everyops !== "call") || typeof data.id !== "number") return;
      const reply = (result: unknown) => target.postMessage({ everyops: "result", id: data.id, result }, "*");
      const { forms, preview, slug, readData, live, site, pageId, recordId, customDomain } = latest.current;
      // A data source's current results: the page's own sections, what the workspace has in hand, else the server.
      const read = async (viewId: string): Promise<unknown> => {
        if (!viewId) return { ok: false, message: "Choose a data source." };
        if (viewId === "page")
          return live
            ? { ok: true, viewId: "page", name: latest.current.title, type: "landing", blocks: live }
            : { ok: false, message: "This page has no sections of its own; name a data source." };
        const local = readData?.(viewId) as { ok?: boolean } | undefined;
        if (local?.ok) return local;
        return getJson(`/api/public/${encodeURIComponent(slug)}/${encodeURIComponent(viewId)}/data`);
      };
      if (data.everyops === "call") {
        const { method, args } = e.data as { method?: unknown; args?: Record<string, unknown> };
        const a = args && typeof args === "object" ? args : {};
        const source = str(data.form);
        switch (method) {
          case "data":
            return reply(await read(source));
          case "site":
            return reply(
              site
                ? { ok: true, site: siteValues(site, slug, customDomain) }
                : { ok: false, message: "This page isn't part of a site." },
            );
          case "route": {
            const query: Record<string, string> = {};
            for (const [k, v] of new URLSearchParams(window.location.search).entries())
              if (Object.keys(query).length < 30) query[k.slice(0, 60)] = v.slice(0, 300);
            return reply({ ok: true, page: pageId ?? "", id: recordId ?? "", query });
          }
          case "items":
            if (source === "site.pages")
              return reply(
                site
                  ? sitePageItems(site, slug, pageId, customDomain)
                  : { ok: false, message: "No site pages." },
              );
            return reply(itemsOf(await read(source), str(a.block)));
          case "record": {
            const list = itemsOf(await read(source));
            if (!list.ok) return reply(list);
            const item = list.items.find((x) => x.id === str(a.id));
            return reply(item ? { ok: true, item } : { ok: false, missing: true, message: "Not found." });
          }
          // The visitor's own booking, from the manage link this page was opened with (?manage=) or one it holds.
          case "mine":
          case "attach": {
            const token =
              str(a.token, 600) || new URLSearchParams(window.location.search).get("manage") || "";
            if (!token) return reply({ ok: false, message: "Open this page from your booking link." });
            const url = `/api/public/booking/${encodeURIComponent(token)}`;
            if (method === "mine") return reply(await getJson(url));
            if (preview)
              return reply({
                ok: false,
                message: "Uploads are disabled in the editor preview. Open the page to upload.",
              });
            if (!(a.file instanceof Blob)) return reply({ ok: false, message: "Choose a picture." });
            const body = new FormData();
            body.append("fieldId", str(a.fieldId, 80));
            body.append("file", a.file);
            return reply(await getJson(url, { method: "POST", body }));
          }
        }
      }
      const form = forms.find((f) => f.viewId === data.form);
      if (!form) return reply({ ok: false, message: "This form isn't taking submissions." });
      const base = `/api/public/${slug}/${form.viewId}`;
      if (data.everyops === "call") {
        const { method, args } = e.data as { method?: unknown; args?: Record<string, unknown> };
        const a = args && typeof args === "object" ? args : {};
        switch (method) {
          case "form":
            return reply({ ok: true, form });
          case "slots":
            return reply(
              await getJson(
                `${base}/slots?${new URLSearchParams({ resource: str(a.resource), date: str(a.date, 10) })}`,
              ),
            );
          case "days":
            return reply(
              await getJson(
                `${base}/days?${new URLSearchParams({ resource: str(a.resource), from: str(a.from, 10), count: String(Math.min(92, Math.max(1, Number(a.count) || 42))) })}`,
              ),
            );
          case "quote":
            return reply(
              await getJson(`${base}/quote`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  values: formValues(form, cleanValues(a.values)),
                  extras: cleanExtras(a.extras),
                }),
              }),
            );
          case "upload": {
            if (preview)
              return reply({
                ok: false,
                message: "Uploads are disabled in the editor preview. Open the page to upload.",
              });
            if (!(a.file instanceof Blob)) return reply({ ok: false, message: "Choose a file." });
            const body = new FormData();
            body.append("file", a.file);
            return reply(await getJson(`${base}/upload`, { method: "POST", body }));
          }
          default:
            return reply({ ok: false, message: "Unknown request." });
        }
      }
      if (preview)
        return reply({
          ok: false,
          message: "Preview only: nothing was saved. Close the editor or open the public page to submit.",
        });
      const extras = cleanExtras((e.data as { extras?: unknown }).extras);
      reply(
        await getJson(base, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values: formValues(form, cleanValues(data.values)), extras }),
        }),
      );
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={frame}
      title={title}
      sandbox={HTML_PAGE_SANDBOX}
      srcDoc={doc}
      onLoad={tellPicking}
      className={cn("block border-0 bg-white", className)}
    />
  );
}
