"use client";

import { useEffect, useMemo, useRef } from "react";
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

/**
 * A custom HTML page in its sandbox, and the other end of its form bridge: a form the page sends is matched to one
 * of the workspace's public forms, converted to that form's fields, and posted to the same endpoint the built-in
 * form uses. Messages from anything but this frame are ignored. In previews nothing is saved.
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
  const doc = useMemo(() => frameDocument(html), [html]);
  const latest = useRef({ forms, preview, slug });
  latest.current = { forms, preview, slug };

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (!target || e.source !== target) return;
      const data = e.data as { everyops?: string; id?: unknown; form?: unknown; values?: unknown } | null;
      if (data?.everyops !== "submit" || typeof data.id !== "number") return;
      const reply = (result: unknown) => target.postMessage({ everyops: "result", id: data.id, result }, "*");
      const { forms, preview, slug } = latest.current;
      const form = forms.find((f) => f.viewId === data.form);
      if (!form) return reply({ ok: false, message: "This form isn't taking submissions." });
      if (preview)
        return reply({
          ok: false,
          message: "Preview only: nothing was saved. Submissions are saved on the public page.",
        });
      try {
        const res = await fetch(`/api/public/${slug}/${form.viewId}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ values: formValues(form, cleanValues(data.values)) }),
        });
        reply(
          (await res.json().catch(() => null)) ?? { ok: false, message: "Something went wrong. Try again." },
        );
      } catch {
        reply({ ok: false, message: "You seem to be offline. Check your connection and try again." });
      }
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
