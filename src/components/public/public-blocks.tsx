"use client";

import {
  CaretDownIcon,
  ClockIcon,
  EnvelopeSimpleIcon,
  HeartIcon,
  LightningIcon,
  MapPinIcon,
  PhoneIcon,
  SealCheckIcon,
  SparkleIcon,
  StarIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/editor/markdown";
import { Reveal } from "@/components/landing/reveal";
import { StatusBadge } from "@/components/records/status-badge";
import { Button } from "@/components/ui/button";
import type { Cell, ResolvedBlock } from "@/lib/public/resolve";
import { cn } from "@/lib/utils";
import { PublicFormView } from "./public-form";

/** What a block is called in the editor. */
export function blockLabel(b: ResolvedBlock): string {
  switch (b.type) {
    case "hero":
      return "Hero";
    case "highlights":
      return "Highlights";
    case "steps":
      return b.title ?? "How it works";
    case "contact":
      return "Contact";
    case "records":
      return b.layout === "faq" ? (b.title ?? "FAQ") : (b.title ?? "List");
    case "form":
      return b.title ?? "Form";
    case "text":
      return "Text";
    case "html":
      return "Custom HTML";
  }
}

export type BlockSelection = {
  selectedId?: string;
  /** Sections that just changed, so they can flash once. */
  changedIds?: Set<string>;
  onSelect: (block: ResolvedBlock) => void;
};

/**
 * Every block of a public page, in order, in EveryOps's standard look. In the app's preview forms don't submit,
 * and with `selection` each section can be clicked to edit it with the assistant.
 */
export function PublicBlocks({
  blocks,
  slug,
  preview,
  selection,
  compact,
}: {
  blocks: ResolvedBlock[];
  slug: string;
  preview?: boolean;
  selection?: BlockSelection;
  /** Inside a form step: tighter spacing and no scroll-in animation. */
  compact?: boolean;
}) {
  return (
    <div className={compact ? "flex flex-col gap-6" : "flex flex-col gap-20 md:gap-24"}>
      {blocks.map((b, i) => {
        const node = <BlockView key={b.id} block={b} slug={slug} preview={preview} />;
        if (selection)
          return (
            <Selectable
              key={b.id}
              label={blockLabel(b)}
              selected={selection.selectedId === b.id}
              changed={selection.changedIds?.has(b.id)}
              onSelect={() => selection.onSelect(b)}
            >
              {node}
            </Selectable>
          );
        // Visitors see each section rise in once as they scroll; the first is there straight away.
        return preview || compact || i === 0 ? (
          <div key={b.id}>{node}</div>
        ) : (
          <Reveal key={b.id}>{node}</Reveal>
        );
      })}
    </div>
  );
}

function BlockView({ block: b, slug, preview }: { block: ResolvedBlock; slug: string; preview?: boolean }) {
  switch (b.type) {
    case "hero":
      return <Hero block={b} preview={preview} />;
    case "highlights":
      return <Highlights block={b} />;
    case "steps":
      return <Steps block={b} />;
    case "contact":
      return <Contact block={b} />;
    case "text":
      return (
        <section className="mx-auto w-full max-w-[720px]">
          <Markdown className="text-[15.5px] leading-relaxed">{b.markdown}</Markdown>
        </section>
      );
    case "html":
      return <HtmlBlock html={b.html} />;
    case "records":
      return <RecordsBlock block={b} />;
    case "form":
      return (
        <section className="mx-auto w-full max-w-[640px]">
          {b.title ? <SectionHeading title={b.title} /> : null}
          <PublicFormView
            form={b.form}
            slug={slug}
            preview={preview}
            renderBlocks={(blocks) => <PublicBlocks blocks={blocks} slug={slug} preview={preview} compact />}
          />
        </section>
      );
  }
}

/**
 * A section in the app's preview that can be picked for the assistant. Hover outlines it and names it; a click
 * selects it. The whole section is one button, so the inside (links, form fields) can't be used by accident.
 */
function Selectable({
  label,
  selected,
  changed,
  onSelect,
  children,
}: {
  label: string;
  selected: boolean;
  changed?: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <div className={cn("group/sel relative rounded-[22px]", changed && "animate-flash")}>
      {children}
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Edit the ${label.toLowerCase()} section with AI`}
        onClick={onSelect}
        className={cn(
          "absolute -inset-3 z-10 cursor-pointer rounded-[22px] outline-none",
          "shadow-[0_0_0_1px_transparent] transition-[box-shadow,background-color] duration-150 ease-out",
          "hover:bg-primary/[0.025] hover:shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_45%,transparent)]",
          "focus-visible:shadow-[0_0_0_2px_var(--primary)]",
          selected &&
            "bg-primary/[0.035] shadow-[0_0_0_2px_var(--primary)] hover:shadow-[0_0_0_2px_var(--primary)]",
        )}
      >
        <span
          className={cn(
            "absolute -top-3 left-5 flex items-center gap-1.5 rounded-full border bg-popover px-2.5 py-1 text-[11.5px] font-medium text-foreground shadow-md",
            "translate-y-1 opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/sel:translate-y-0 group-hover/sel:opacity-100 group-focus-within/sel:translate-y-0 group-focus-within/sel:opacity-100",
            selected && "translate-y-0 border-primary/50 opacity-100",
          )}
        >
          <span className="size-1.5 rounded-full bg-primary" />
          {label}
        </span>
        <span
          className={cn(
            "absolute -top-3 right-5 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-medium shadow-md",
            "translate-y-1 opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/sel:translate-y-0 group-hover/sel:opacity-100 group-focus-within/sel:translate-y-0 group-focus-within/sel:opacity-100",
            selected
              ? "translate-y-0 bg-primary text-primary-foreground opacity-100"
              : "border bg-popover text-muted-foreground",
          )}
        >
          <SparkleIcon weight="fill" className="size-3" />
          {selected ? "Editing with AI" : "Edit with AI"}
        </span>
      </button>
    </div>
  );
}

function SectionHeading({ title, center }: { title: string; center?: boolean }) {
  return (
    <h2
      className={cn(
        "mb-6 text-balance text-[24px] font-semibold leading-tight tracking-[-0.02em] md:text-[30px]",
        center && "text-center",
      )}
    >
      {title}
    </h2>
  );
}

function Hero({ block, preview }: { block: Extract<ResolvedBlock, { type: "hero" }>; preview?: boolean }) {
  return (
    <section className="relative overflow-hidden rounded-[22px] border px-6 py-20 text-center md:px-12 md:py-28">
      <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 opacity-50" />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[-200px] left-1/2 h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-primary/[0.18] blur-[110px]"
      />
      <div className="relative mx-auto flex max-w-[760px] flex-col items-center gap-5">
        <h1 className="text-balance text-[38px] font-semibold leading-[1.05] tracking-[-0.035em] md:text-[60px]">
          {block.heading}
        </h1>
        {block.subheading ? (
          <p className="max-w-[560px] text-pretty text-[16px] leading-relaxed text-muted-foreground md:text-[18px]">
            {block.subheading}
          </p>
        ) : null}
        {block.ctaHref && block.ctaLabel ? (
          <Button
            size="lg"
            className="mt-3 h-11 rounded-full px-6 text-[15px]"
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

const HIGHLIGHT_ICONS = [SealCheckIcon, LightningIcon, HeartIcon, StarIcon];

type ItemsBlock = Extract<ResolvedBlock, { type: "highlights" | "steps" }>;

function Highlights({ block }: { block: ItemsBlock }) {
  return (
    <section className="w-full">
      {block.title ? <SectionHeading title={block.title} /> : null}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {block.items.map((item, i) => {
          const Icon = HIGHLIGHT_ICONS[i % HIGHLIGHT_ICONS.length];
          return (
            <article key={item.title} className="flex flex-col gap-3 rounded-2xl border bg-card/60 p-6">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <Icon weight="duotone" className="size-5" />
              </span>
              <h3 className="text-[16px] font-semibold tracking-[-0.01em]">{item.title}</h3>
              {item.body ? (
                <p className="text-[14px] leading-relaxed text-muted-foreground">{item.body}</p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function Steps({ block }: { block: ItemsBlock }) {
  return (
    <section className="w-full">
      <SectionHeading title={block.title ?? "How it works"} />
      <ol className="grid gap-4 md:grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
        {block.items.map((item, i) => (
          <li key={item.title} className="relative flex flex-col gap-3 rounded-2xl border p-6">
            <span className="flex size-8 items-center justify-center rounded-full border border-primary/40 font-mono text-[13px] font-semibold text-primary tabular">
              {i + 1}
            </span>
            <h3 className="text-[16px] font-semibold tracking-[-0.01em]">{item.title}</h3>
            {item.body ? (
              <p className="text-[14px] leading-relaxed text-muted-foreground">{item.body}</p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function Contact({ block }: { block: Extract<ResolvedBlock, { type: "contact" }> }) {
  const rows = [
    block.phone && {
      Icon: PhoneIcon,
      label: "Phone",
      value: block.phone,
      href: `tel:${block.phone.replace(/[^+\d]/g, "")}`,
    },
    block.email && {
      Icon: EnvelopeSimpleIcon,
      label: "Email",
      value: block.email,
      href: `mailto:${block.email}`,
    },
    block.address && {
      Icon: MapPinIcon,
      label: "Address",
      value: block.address,
      href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(block.address)}`,
    },
    block.hours && { Icon: ClockIcon, label: "Hours", value: block.hours },
  ].filter((r): r is { Icon: typeof PhoneIcon; label: string; value: string; href?: string } => !!r);
  return (
    <section className="w-full">
      <SectionHeading title={block.title ?? "Visit or reach us"} />
      <dl className="grid gap-px overflow-hidden rounded-2xl border bg-border sm:grid-cols-2">
        {rows.map(({ Icon, label, value, href }) => (
          <div key={label} className="flex items-start gap-3.5 bg-shell p-5">
            <Icon weight="duotone" className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <dt className="text-[12.5px] text-muted-foreground">{label}</dt>
              <dd className="mt-0.5 text-[15px] [overflow-wrap:anywhere]">
                {href ? (
                  <a
                    href={href}
                    target={label === "Address" ? "_blank" : undefined}
                    rel="noreferrer"
                    className="hover:text-primary"
                  >
                    {value}
                  </a>
                ) : (
                  value
                )}
              </dd>
            </div>
          </div>
        ))}
      </dl>
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

/** A card: picture on top, the name, a price that stands out, then the rest. */
function Card({ cells }: { cells: Cell[] }) {
  const [title, ...rest] = cells;
  const image = rest.find((c) => c.kind === "image" && c.text);
  const price = rest.find((c) => /₱|PHP|\$/.test(c.text) && c.kind !== "markdown" && c.kind !== "image");
  const notes = rest.filter((c) => c.kind === "markdown" && c.text);
  const others = rest.filter(
    (c) => c !== image && c !== price && !notes.includes(c) && c.text && c.kind !== "image",
  );
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl border bg-card/60 transition-colors duration-150 hover:border-foreground/20">
      {image ? (
        <div className="flex justify-center border-b bg-white/[0.03] p-5">
          <CellView cell={image} large />
        </div>
      ) : null}
      <div className="flex flex-1 flex-col gap-3 p-5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-[16px] font-semibold tracking-[-0.01em]">{title?.text}</h3>
          {price ? (
            <span className="shrink-0 rounded-full bg-primary/12 px-2.5 py-0.5 font-mono text-[13px] font-medium text-primary tabular">
              {price.text}
            </span>
          ) : null}
        </div>
        {others.length ? (
          <dl className="flex flex-col gap-1.5 text-[13.5px]">
            {others.map((c) => (
              <div key={c.fieldId} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{c.name}</dt>
                <dd className="text-right">
                  <CellView cell={c} />
                </dd>
              </div>
            ))}
          </dl>
        ) : null}
        {notes.map((c) => (
          <div key={c.fieldId} className="line-clamp-4">
            <CellView cell={c} />
          </div>
        ))}
      </div>
    </article>
  );
}

function RecordsBlock({ block }: { block: Extract<ResolvedBlock, { type: "records" }> }) {
  const heading = block.title ? <SectionHeading title={block.title} /> : null;
  if (!block.items.length) return null;
  if (block.layout === "faq")
    return (
      <section className="mx-auto w-full max-w-[760px]">
        {heading}
        <div className="divide-y rounded-2xl border">
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
        <div className="overflow-x-auto rounded-2xl border">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b text-left text-[12.5px] text-muted-foreground">
                {block.columns.map((c) => (
                  <th key={c.id} className="px-5 py-3 font-medium">
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.items.map((item) => (
                <tr key={item.id} className="border-b last:border-0">
                  {item.cells.map((c) => (
                    <td key={c.fieldId} className="px-5 py-3 align-top">
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
        <ul className="divide-y rounded-2xl border">
          {block.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3.5 text-[14.5px]"
            >
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
        {block.items.map((item) => (
          <Card key={item.id} cells={item.cells} />
        ))}
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
        className="flex w-full cursor-pointer items-center gap-3 px-5 py-4 text-left text-[15px] font-medium outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40"
      >
        <span className="flex-1">{question?.text}</span>
        <CaretDownIcon
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
            open && "rotate-180",
          )}
        />
      </button>
      {/* Grid rows animate the height without measuring it. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows,opacity] duration-200 ease-(--ease-out-strong)",
          open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="px-5 pb-4">
            {answer.map((c) => (
              <CellView key={c.fieldId} cell={c} />
            ))}
          </div>
        </div>
      </div>
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
