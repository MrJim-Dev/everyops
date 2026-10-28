"use client";

import {
  ArrowUpIcon,
  BrowserIcon,
  GlobeSimpleIcon,
  LightningIcon,
  LockSimpleIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { formatDistanceToNowStrict } from "date-fns";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { HtmlPageFrame } from "@/components/public/html-page-frame";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SearchInput } from "@/components/views/search-input";
import { ViewEmpty } from "@/components/views/view-empty";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useAssistant } from "@/lib/assistant/panel-store";
import { type PageAudience, type PageEntry, pagesOf } from "@/lib/pages";
import { publicTableData, workspaceTableData } from "@/lib/public/page-data";
import { htmlPage } from "@/lib/public/resolve";
import { canManage } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";

type Filter = "all" | PageAudience;

function Count({ n }: { n: number }) {
  return <span className="ml-1.5 text-[12px] font-normal text-muted-foreground tabular">{n}</span>;
}

/**
 * /w/[workspace]/pages: every page in the workspace (reports, price lists, booking and home pages) as cards with a
 * live preview, who can open each one and when it last changed. Owners and admins describe a new page here and Ask
 * EveryOps makes it from the workspace's live data, the way it makes any other change.
 */
export function PagesLibrary() {
  const ws = useWorkspace();
  const manager = ws.mode === "live" && canManage(ws.role);
  const pages = useMemo(() => pagesOf(ws.blueprint, ws.docs), [ws.blueprint, ws.docs]);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const q = query.trim().toLowerCase();
  const shown = pages.filter(
    (p) =>
      (filter === "all" || p.audience === filter) &&
      (!q || `${p.title} ${p.system.name} ${p.summary}`.toLowerCase().includes(q)),
  );
  const count = (a: PageAudience) => pages.filter((p) => p.audience === a).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PageHeader
        title="Pages"
        description="Reports, price lists, booking and home pages, made from your live data."
        className="border-b pb-3"
        actions={
          manager ? (
            <Button size="sm" onClick={() => box.current?.focus()}>
              <SparkleIcon data-icon="inline-start" />
              New page
            </Button>
          ) : undefined
        }
      />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-5">
        {manager ? <MakePage box={box} /> : null}
        {pages.length ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SegmentedControl
                label="Who can open them"
                value={filter}
                onValueChange={(v) => setFilter(v as Filter)}
                options={[
                  {
                    value: "all",
                    label: (
                      <>
                        All
                        <Count n={pages.length} />
                      </>
                    ),
                  },
                  {
                    value: "team",
                    label: (
                      <>
                        Team only
                        <Count n={count("team")} />
                      </>
                    ),
                  },
                  {
                    value: "anyone",
                    label: (
                      <>
                        Shared
                        <Count n={count("anyone")} />
                      </>
                    ),
                  },
                ]}
              />
              <SearchInput value={query} onChange={setQuery} placeholder="Search pages" />
            </div>
            {shown.length ? (
              <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {shown.map((p) => (
                  <li key={p.view.id}>
                    <PageCard page={p} />
                  </li>
                ))}
              </ul>
            ) : (
              <ViewEmpty title="No pages match" description="Try another word, or show all pages." />
            )}
          </>
        ) : (
          <ViewEmpty
            title="No pages yet"
            description={
              manager
                ? "Describe a page above: a report for this month, a price list for customers, a page to share with your team."
                : "Pages your owners and admins make show up here."
            }
          />
        )}
      </div>
    </div>
  );
}

/**
 * Ideas for a page, from the workspace's own record types: the main thing it tracks (bookings first, they're what
 * most owners report on) and the things that earn (courts, rooms, products).
 */
function useIdeas(): string[] {
  const ws = useWorkspace();
  return useMemo(() => {
    const own = ws.blueprint.entities.filter((e) => !e.parent);
    const main = own.find((e) => e.booking) ?? own[0];
    const earner = own.find((e) => e.resource) ?? own.find((e) => e !== main);
    return [
      main ? `This month's ${main.pluralName.toLowerCase()} at a glance` : "This month at a glance",
      earner
        ? `Which ${earner.pluralName.toLowerCase()} bring in the most`
        : "A weekly summary to share with the team",
      "A price list customers can open from a link",
    ];
  }, [ws.blueprint.entities]);
}

function MakePage({ box }: { box: React.RefObject<HTMLTextAreaElement | null> }) {
  const [text, setText] = useState("");
  const ideas = useIdeas();
  const sendRequest = useAssistant((s) => s.sendRequest);
  const make = (what: string) => {
    const clean = what.trim();
    if (!clean) return;
    sendRequest(`Make a page: ${clean}`);
    setText("");
  };
  return (
    <section
      aria-label="Make a page"
      className="flex flex-col gap-3 rounded-xl border bg-card/60 p-4 shadow-xs focus-within:border-foreground/25"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <SparkleIcon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[14px] font-semibold">What should the page show?</h2>
          <p className="text-[12.5px] text-muted-foreground">
            Ask EveryOps puts it together from your records and keeps it up to date. It stays with your team
            until you share it.
          </p>
        </div>
      </div>
      <form
        className="flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          make(text);
        }}
      >
        <Textarea
          ref={box}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              make(text);
            }
          }}
          rows={2}
          maxLength={2000}
          aria-label="What should the page show?"
          placeholder="e.g. October's bookings and revenue by court, with the busiest hours"
          className="min-h-[60px] resize-none text-[13.5px]"
        />
        <Button type="submit" size="icon" aria-label="Make page" disabled={!text.trim()}>
          <ArrowUpIcon />
        </Button>
      </form>
      <div className="flex flex-wrap gap-2">
        {ideas.map((idea) => (
          <button
            key={idea}
            type="button"
            onClick={() => make(idea)}
            className="cursor-pointer rounded-full border px-3 py-1 text-[12.5px] text-muted-foreground outline-none transition-colors duration-150 hover:border-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {idea}
          </button>
        ))}
      </div>
    </section>
  );
}

const AUDIENCE: Record<PageAudience, { label: string; Icon: typeof GlobeSimpleIcon }> = {
  team: { label: "Team only", Icon: LockSimpleIcon },
  anyone: { label: "Anyone with the link", Icon: GlobeSimpleIcon },
};

function PageCard({ page }: { page: PageEntry }) {
  const ws = useWorkspace();
  const { label, Icon } = AUDIENCE[page.audience];
  const href = `${ws.basePath}/${page.system.id}/${page.view.id}`;
  return (
    <Link
      href={href}
      className="group/page flex h-full flex-col overflow-hidden rounded-xl border bg-card outline-none transition-[border-color,transform] duration-150 ease-out hover:border-foreground/25 focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.99]"
    >
      <PageThumb page={page} />
      <div className="flex flex-1 flex-col gap-1.5 border-t p-3.5">
        <div className="flex items-center gap-2">
          <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{page.title}</h3>
          {page.view.type === "html" ? (
            <span
              title="Shows your records as they are now, every time it opens"
              className="flex shrink-0 items-center gap-1 text-[11.5px] text-primary"
            >
              <LightningIcon weight="fill" className="size-3" />
              Live
            </span>
          ) : null}
        </div>
        <p className="line-clamp-2 min-h-[2.6em] text-[12.5px] leading-[1.3] text-muted-foreground">
          {page.summary || page.system.name}
        </p>
        <div className="mt-auto flex items-center gap-2 pt-1.5 text-[12px] text-muted-foreground">
          <Icon className={cn("size-3.5", page.audience === "anyone" && "text-primary")} />
          <span className="truncate">{label}</span>
          {page.updatedAt ? (
            <span className="ml-auto shrink-0 tabular">
              Updated {formatDistanceToNowStrict(new Date(page.updatedAt), { addSuffix: true })}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}

const FRAME_WIDTH = 1200;
const FRAME_HEIGHT = 750;

/** A small, still picture of the page: the real page in its sandbox at desktop width, scaled down to the card. */
function PageThumb({ page }: { page: PageEntry }) {
  const ws = useWorkspace();
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => setScale(el.clientWidth / FRAME_WIDTH);
    fit();
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const view = page.view;
  const resolved = useMemo(
    () => (view.type === "html" ? htmlPage(ws.blueprint, ws.records, ws.docs, view, ws.name) : null),
    [ws.blueprint, ws.records, ws.docs, view, ws.name],
  );
  const readData = (id: string) =>
    page.audience === "anyone"
      ? publicTableData(ws.blueprint, ws.records, id)
      : workspaceTableData(ws.blueprint, ws.records, id);

  return (
    <div ref={box} aria-hidden className="relative aspect-[16/10] overflow-hidden bg-muted/40">
      {resolved && scale ? (
        <div
          className="pointer-events-none absolute top-0 left-0 origin-top-left"
          style={{ width: FRAME_WIDTH, height: FRAME_HEIGHT, transform: `scale(${scale})` }}
        >
          <HtmlPageFrame
            preview
            html={resolved.html ?? ""}
            slug={ws.id}
            forms={resolved.forms ?? []}
            readData={readData}
            live={resolved.live}
            site={resolved.site}
            pageId={view.id}
            title={page.title}
            className="size-full border-0"
          />
        </div>
      ) : view.type === "landing" ? (
        <div className="flex size-full flex-col justify-center gap-2 bg-gradient-to-br from-primary/15 via-transparent to-transparent p-5">
          <GlobeSimpleIcon className="size-5 text-primary" />
          <p className="line-clamp-2 text-[15px] font-semibold tracking-tight">
            {view.blocks.find((b) => b.type === "hero")?.type === "hero"
              ? (view.blocks.find((b) => b.type === "hero") as { heading: string }).heading
              : view.name}
          </p>
          <p className="text-[12px] text-muted-foreground">{view.blocks.length} sections</p>
        </div>
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <BrowserIcon className="size-6" />
        </div>
      )}
      {/* The frame never takes clicks, so the whole card opens the page. */}
      <span className="absolute inset-0" />
    </div>
  );
}
