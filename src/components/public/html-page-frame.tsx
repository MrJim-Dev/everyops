"use client";

import { useEffect, useMemo, useRef } from "react";
import { withSiteLinks } from "@/lib/public/custom-site";
import { formValues, frameDocument, HTML_PAGE_SANDBOX, type RawFormValues } from "@/lib/public/html-page";
import type { PublicForm } from "@/lib/public/resolve";
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
  title,
  className,
}: {
  html: string;
  slug: string;
  forms: PublicForm[];
  preview?: boolean;
  title: string;
  className?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  // Links the page was created with ("/s/<site>/book") point at this workspace's real pages.
  const doc = useMemo(() => frameDocument(withSiteLinks(html, slug)), [html, slug]);
  const latest = useRef({ forms, preview, slug });
  latest.current = { forms, preview, slug };

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (!target || e.source !== target) return;
      const data = e.data as { everyops?: string; id?: unknown; form?: unknown; values?: unknown } | null;
      if ((data?.everyops !== "submit" && data?.everyops !== "call") || typeof data.id !== "number") return;
      const reply = (result: unknown) => target.postMessage({ everyops: "result", id: data.id, result }, "*");
      const { forms, preview, slug } = latest.current;
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
            if (preview) return reply({ ok: false, message: "Uploads work on the public page." });
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
          message: "Preview only: nothing was saved. Submissions are saved on the public page.",
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
      className={cn("block border-0 bg-white", className)}
    />
  );
}
