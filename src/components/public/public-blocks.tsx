"use client";

import { CaretDownIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/editor/markdown";
import { StatusBadge } from "@/components/records/status-badge";
import { Button } from "@/components/ui/button";
import type { Cell, ResolvedBlock } from "@/lib/public/resolve";
import { cn } from "@/lib/utils";
import { PublicFormView } from "./public-form";

/** Every block of a public page, in order. In the app's preview, forms don't submit. */
export function PublicBlocks({
  blocks,
  slug,
  preview,
}: {
  blocks: ResolvedBlock[];
  slug: string;
  preview?: boolean;
}) {
  return (
    <div className="flex flex-col gap-12">
      {blocks.map((b) => {
        switch (b.type) {
          case "hero":
            return <Hero key={b.id} block={b} preview={preview} />;
          case "text":
            return (
              <section key={b.id} className="mx-auto w-full max-w-[760px]">
                <Markdown className="text-[15px]">{b.markdown}</Markdown>
              </section>
            );
          case "html":
            return <HtmlBlock key={b.id} html={b.html} />;
          case "records":
            return <RecordsBlock key={b.id} block={b} />;
          case "form":
            return (
              <section key={b.id} className="mx-auto w-full max-w-[640px]">
                {b.title ? (
                  <h2 className="mb-4 text-[20px] font-semibold tracking-tight">{b.title}</h2>
                ) : null}
                <PublicFormView form={b.form} slug={slug} preview={preview} />
              </section>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

function Hero({ block, preview }: { block: Extract<ResolvedBlock, { type: "hero" }>; preview?: boolean }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border px-6 py-16 text-center md:py-24">
      <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-160px] left-1/2 h-[360px] w-[640px] -translate-x-1/2 rounded-full bg-primary/[0.16] blur-[100px]"
      />
      <div className="relative mx-auto flex max-w-[720px] flex-col items-center gap-4">
        <h1 className="text-balance text-[34px] font-semibold leading-tight tracking-[-0.03em] md:text-[48px]">
          {block.heading}
        </h1>
        {block.subheading ? (
          <p className="text-balance text-[16px] leading-relaxed text-muted-foreground md:text-[18px]">
            {block.subheading}
          </p>
        ) : null}
        {block.ctaHref && block.ctaLabel ? (
          <Button
            size="lg"
            className="mt-2"
            nativeButton={false}
            render={<Link href={block.ctaHref} target={preview ? "_blank" : undefined} />}
          >
            {block.ctaLabel}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

/** Values in a card or list: images large (QR codes), markdown rendered, statuses as badges. */
function CellView({ cell, large }: { cell: Cell; large?: boolean }) {
  if (!cell.text) return null;
  switch (cell.kind) {
    case "image":
      return (
        // biome-ignore lint/performance/noImgElement: uploaded images served by our own route
        <img
          src={cell.text}
          alt={cell.name}
          loading="lazy"
          className={cn("rounded-lg border bg-white object-contain", large ? "size-44" : "size-12")}
        />
      );
    case "markdown":
      return <Markdown className="text-[13.5px] text-muted-foreground">{cell.text}</Markdown>;
    case "status":
      return <StatusBadge label={cell.text} tone={cell.tone ?? "neutral"} />;
    case "number":
      return <span className="font-mono tabular">{cell.text}</span>;
    default:
      return <span>{cell.text}</span>;
  }
}

function RecordsBlock({ block }: { block: Extract<ResolvedBlock, { type: "records" }> }) {
  const heading = block.title ? (
    <h2 className="mb-4 text-[20px] font-semibold tracking-tight">{block.title}</h2>
  ) : null;
  if (!block.items.length) return null;
  if (block.layout === "faq")
    return (
      <section className="mx-auto w-full max-w-[760px]">
        {heading}
        <div className="divide-y rounded-xl border">
          {block.items.map((item) => (
            <FaqItem key={item.id} cells={item.cells} />
          ))}
        </div>
      </section>
    );
  if (block.layout === "table")
    return (
      <section className="w-full">
        {heading}
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-[13.5px]">
            <thead>
              <tr className="border-b text-left text-[12px] text-muted-foreground">
                {block.columns.map((c) => (
                  <th key={c.id} className="px-4 py-2.5 font-medium">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  {item.cells.map((c) => (
                    <td key={c.fieldId} className="px-4 py-2.5 align-top">
                      <CellView cell={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  if (block.layout === "list")
    return (
      <section className="mx-auto w-full max-w-[760px]">
        {heading}
        <ul className="divide-y rounded-xl border">
          {block.items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-[14px]">
              <span className="min-w-0 flex-1 font-medium">{item.cells[0]?.text}</span>
              {item.cells.slice(1).map((c) => (
                <span key={c.fieldId} className="text-muted-foreground">
                  <CellView cell={c} />
                </span>
              ))}
            </li>
          ))}
        </ul>
      </section>
    );
  return (
    <section className="w-full">
      {heading}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {block.items.map((item) => {
          const [title, ...rest] = item.cells;
          const images = rest.filter((c) => c.kind === "image" && c.text);
          const others = rest.filter((c) => c.kind !== "image");
          return (
            <article key={item.id} className="flex flex-col gap-3 rounded-xl border bg-card p-5">
              <h3 className="text-[15px] font-semibold">{title?.text}</h3>
              <dl className="flex flex-col gap-1.5 text-[13.5px]">
                {others
                  .filter((c) => c.text)
                  .map((c) =>
                    c.kind === "markdown" ? (
                      <div key={c.fieldId}>
                        <CellView cell={c} />
                      </div>
                    ) : (
                      <div key={c.fieldId} className="flex justify-between gap-3">
                        <dt className="text-muted-foreground">{c.name}</dt>
                        <dd className="text-right">
                          <CellView cell={c} />
                        </dd>
                      </div>
                    ),
                  )}
              </dl>
              {images.map((c) => (
                <div key={c.fieldId} className="flex justify-center pt-1">
                  <CellView cell={c} large />
                </div>
              ))}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function FaqItem({ cells }: { cells: Cell[] }) {
  const [open, setOpen] = useState(false);
  const [question, ...answer] = cells;
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left text-[14.5px] font-medium outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
      >
        <span className="flex-1">{question?.text}</span>
        <CaretDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <div className="animate-rise px-5 pb-4">
          {answer.map((c) => (
            <CellView key={c.fieldId} cell={c} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Owner-written HTML in a sandboxed frame: scripts may run, but in an opaque origin with no access to the app,
 * its cookies or the page around it. The frame reports its height so it sits in the page without scrollbars.
 */
function HtmlBlock({ html }: { html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(240);
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow) return;
      const h = Number((e.data as { everyopsHeight?: number })?.everyopsHeight);
      if (h > 0) setHeight(Math.min(h + 2, 6000));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:transparent;color:#ededed;font-family:system-ui,sans-serif}</style></head><body>${html}<script>new ResizeObserver(()=>parent.postMessage({everyopsHeight:document.documentElement.scrollHeight},"*")).observe(document.documentElement)</script></body></html>`;
  return (
    <iframe
      ref={frame}
      title="Custom section"
      sandbox="allow-scripts allow-popups"
      srcDoc={doc}
      style={{ height }}
      className="w-full rounded-xl border-0"
    />
  );
}
