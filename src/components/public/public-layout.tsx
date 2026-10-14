"use client";

import { useMemo, useState } from "react";
import {
  AccordionFrame,
  AccordionItems,
  AlertPart,
  CardPart,
  HeadingPart,
  LinkButton,
  SeparatorPart,
  TabsPart,
  TextPart,
} from "@/components/layout-page/basics";
import {
  DailyChartView,
  LeaderboardView,
  Pager,
  SearchBox,
  StagesView,
  StatCardsView,
} from "@/components/layout-page/blocks";
import { CartesianView, PieView, RadarView, RadialView } from "@/components/layout-page/charts";
import {
  BadgesView,
  CalendarView,
  CarouselView,
  counted,
  GoalBarView,
  ListRow,
  StatView,
  TABLE,
} from "@/components/layout-page/data";
import { Nothing, PartCard, PartGrid } from "@/components/layout-page/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { PublicLayout, PublicLayoutItem } from "@/lib/public/layout";
import type { Cell, PublicItem, ResolvedBlock } from "@/lib/public/resolve";
import { cn } from "@/lib/utils";
import { PublicBlocks } from "./public-blocks";

/** A visitor's view of a public layout page: the server already worked out every part (src/lib/public/layout.ts). */
export function PublicLayoutView({
  layout,
  slug,
  preview,
}: {
  layout: PublicLayout;
  slug: string;
  preview?: boolean;
}) {
  return (
    <div className="flex flex-col gap-8">
      {layout.sections.map((s) => (
        <section key={s.id} className="flex flex-col gap-2.5">
          {s.title || s.description ? (
            <header className="flex items-baseline gap-2">
              {s.title ? (
                <h2 className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
                  {s.title}
                </h2>
              ) : null}
              {s.description ? (
                <p className="truncate text-[12px] text-muted-foreground/80">{s.description}</p>
              ) : null}
            </header>
          ) : null}
          <div className="overflow-hidden rounded-xl border">
            <PartGrid
              items={s.items}
              columns={s.columns}
              render={(item) => <PublicPart item={item} slug={slug} preview={preview} />}
            />
          </div>
        </section>
      ))}
    </div>
  );
}

function PublicPart({ item, slug, preview }: { item: PublicLayoutItem; slug: string; preview?: boolean }) {
  // biome-ignore lint/suspicious/noExplicitAny: the server shaped this data for this component (resolveLayout)
  const d = item.data as any;
  switch (item.component) {
    case "heading":
      return <HeadingPart props={d} />;
    case "text":
      return <TextPart props={d} />;
    case "card":
      return <CardPart props={d} />;
    case "alert":
      return <AlertPart props={d} />;
    case "separator":
      return <SeparatorPart />;
    case "button":
      return <LinkButton href={d.href} label={d.label} variant={d.variant} />;
    case "accordion":
      return (
        <AccordionFrame title={d.title}>
          <AccordionItems items={d.items} />
        </AccordionFrame>
      );
    case "tabs":
      return (
        <TabsPart
          props={d}
          renderItem={(x) => (
            <PublicPart item={x as unknown as PublicLayoutItem} slug={slug} preview={preview} />
          )}
        />
      );
    case "stat":
      return <StatView data={d.stat} />;
    case "stat_cards":
      return <StatCardsView stats={d.stats} />;
    case "progress":
      return <GoalBarView data={d.goal} />;
    case "chart_radial":
      return <RadialView data={d.goal} />;
    case "chart_area":
    case "chart_bar":
    case "chart_line":
      return (
        <CartesianView
          head={d.head}
          data={d.chart}
          shape={item.component === "chart_area" ? "area" : item.component === "chart_bar" ? "bar" : "line"}
          stacked={d.stacked}
        />
      );
    case "chart_pie":
      return <PieView head={d.head} data={d.chart} donut={d.donut} />;
    case "chart_radar":
      return <RadarView head={d.head} data={d.chart} />;
    case "chart_interactive":
      return <DailyChartView title={d.title} description={d.description} data={d.chart} />;
    case "leaderboard":
      return <LeaderboardView title={d.title} ranked={d.ranked} kind={d.kind} />;
    case "status_overview":
      return <StagesView title={d.title} total={d.total} plural={d.plural} stages={d.stages} />;
    case "badges":
      return <BadgesView title={d.title} items={d.items} />;
    case "table":
    case "data_table":
      return <CellTable {...d} />;
    case "list":
      return <CellList {...d} />;
    case "carousel":
      return <CarouselView title={d.title} items={d.items} />;
    case "calendar":
      return <CalendarView title={d.title} plural={d.plural} counts={d.counts} />;
    case "form":
      return (
        <div className="h-full bg-background px-5 py-5">
          <PublicBlocks blocks={[d.block as ResolvedBlock]} slug={slug} preview={preview} compact />
        </div>
      );
    default:
      return null;
  }
}

/** A cell as text: statuses and choices as small pills, numbers in tabular figures, pictures as thumbnails. */
function CellValue({ cell }: { cell: Cell }) {
  if (!cell.text) return <span className="text-muted-foreground/50">—</span>;
  if (cell.kind === "image")
    return (
      // biome-ignore lint/performance/noImgElement: uploads are served by our own route
      <img src={cell.text} alt={cell.name} className="h-8 w-8 rounded-md border bg-white object-contain" />
    );
  if (cell.kind === "status" || cell.kind === "tag")
    return (
      <span className="inline-flex items-center gap-1.5 text-[12.5px]">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            cell.tone === "danger"
              ? "bg-destructive"
              : cell.tone === "warning"
                ? "bg-amber-500"
                : cell.kind === "status"
                  ? "bg-primary"
                  : "bg-muted-foreground/60",
          )}
        />
        {cell.text}
      </span>
    );
  return <span className={cn(cell.kind === "number" && "font-mono tabular-nums")}>{cell.text}</span>;
}

/** The fields a public layout names, in the app's table look; the data table adds search and pages. */
function CellTable({
  title,
  total,
  columns,
  items,
  pageSize,
  searchable,
}: {
  title: string;
  total: number;
  columns: { id: string; name: string }[];
  items: PublicItem[];
  pageSize?: number;
  searchable?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const matching = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? items.filter((r) => r.cells.some((c) => c.text.toLowerCase().includes(q))) : items;
  }, [items, query]);
  const size = Math.max(1, pageSize ?? matching.length);
  const pages = Math.max(1, Math.ceil(matching.length / size));
  const at = Math.min(page, pages - 1);
  const shown = pageSize ? matching.slice(at * size, (at + 1) * size) : matching;
  const numeric = (i: number) => items[0]?.cells[i]?.kind === "number";
  return (
    <PartCard
      title={counted(title, searchable ? matching.length : total)}
      action={
        searchable ? (
          <SearchBox
            value={query}
            onChange={(v) => {
              setQuery(v);
              setPage(0);
            }}
            label={`Search ${title.toLowerCase()}`}
          />
        ) : undefined
      }
      footer={pageSize && pages > 1 ? <Pager at={at} pages={pages} onPage={setPage} /> : undefined}
      contentClassName="px-0 pb-1"
    >
      {shown.length ? (
        <Table className={TABLE.table}>
          <TableHeader>
            <TableRow className={TABLE.headRow}>
              {columns.map((c, i) => (
                <TableHead key={c.id} className={cn(TABLE.head, numeric(i) && "text-right")}>
                  {c.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.id} className={TABLE.row}>
                {r.cells.map((c, i) => (
                  <TableCell key={c.fieldId} className={cn(TABLE.cell, numeric(i) && "text-right")}>
                    <CellValue cell={c} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="px-5 pb-3">
          <Nothing>{query ? "Nothing matches." : undefined}</Nothing>
        </div>
      )}
    </PartCard>
  );
}

function CellList({
  title,
  total,
  items,
}: {
  title: string;
  total: number;
  items: { id: string; title: string; description?: string; badge?: Cell; image?: string }[];
}) {
  return (
    <PartCard title={counted(title, total)} contentClassName="px-0 pb-2">
      {items.length ? (
        <ul>
          {items.map((it) => (
            <li key={it.id}>
              <ListRow
                title={it.title}
                description={it.description}
                image={it.image}
                right={it.badge ? <CellValue cell={it.badge} /> : undefined}
              />
            </li>
          ))}
        </ul>
      ) : (
        <div className="px-5 pb-2">
          <Nothing />
        </div>
      )}
    </PartCard>
  );
}
