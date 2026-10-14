"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AccordionItems,
  AlertPart,
  CardPart,
  HeadingPart,
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
import { BadgesView, CalendarView, CarouselView, GoalBarView, StatView } from "@/components/layout-page/data";
import { Nothing, PartCard } from "@/components/layout-page/shared";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { componentDef } from "@/lib/components/registry";
import { initials } from "@/lib/format";
import type { PublicLayout, PublicLayoutItem } from "@/lib/public/layout";
import type { Cell, PublicItem, ResolvedBlock } from "@/lib/public/resolve";
import { cn } from "@/lib/utils";
import { PublicBlocks } from "./public-blocks";

const COLS: Record<number, string> = {
  1: "",
  2: "md:grid-cols-2",
  3: "md:grid-cols-2 xl:grid-cols-3",
  4: "md:grid-cols-2 xl:grid-cols-4",
};
const SPAN: Record<number, string> = {
  1: "",
  2: "md:col-span-2",
  3: "md:col-span-2 xl:col-span-3",
  4: "md:col-span-2 xl:col-span-4",
};

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
    <div className="flex flex-col gap-10">
      {layout.sections.map((s) => {
        const columns = Math.min(4, Math.max(1, s.columns || 1));
        return (
          <section key={s.id} className="flex flex-col gap-3">
            {s.title || s.description ? (
              <header className="flex flex-col gap-0.5">
                {s.title ? <h2 className="text-[18px] font-semibold tracking-[-0.01em]">{s.title}</h2> : null}
                {s.description ? (
                  <p className="text-[13.5px] text-muted-foreground">{s.description}</p>
                ) : null}
              </header>
            ) : null}
            <div className={cn("grid grid-cols-1 gap-4", COLS[columns])}>
              {s.items.map((item) => {
                const wide = componentDef(item.component)?.wide;
                const span = Math.min(columns, item.span ?? (wide ? columns : 1));
                return (
                  <div key={item.id} className={cn("min-w-0", SPAN[span])}>
                    <PublicPart item={item} slug={slug} preview={preview} />
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
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
      return (
        <Link href={d.href} className={cn(buttonVariants({ variant: d.variant }), "w-fit")}>
          {d.label}
        </Link>
      );
    case "accordion":
      return d.title ? (
        <PartCard title={d.title}>
          <AccordionItems items={d.items} />
        </PartCard>
      ) : (
        <AccordionItems items={d.items} />
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
      return <PublicBlocks blocks={[d.block as ResolvedBlock]} slug={slug} preview={preview} compact />;
    default:
      return null;
  }
}

function CellValue({ cell }: { cell: Cell }) {
  if (!cell.text) return <span className="text-muted-foreground/50">—</span>;
  if (cell.kind === "image")
    return (
      // biome-ignore lint/performance/noImgElement: uploads are served by our own route
      <img src={cell.text} alt={cell.name} className="h-9 w-9 rounded-md border bg-white object-contain" />
    );
  if (cell.kind === "status" || cell.kind === "tag")
    return (
      <Badge variant={cell.tone === "danger" ? "destructive" : "secondary"} className="font-normal">
        {cell.text}
      </Badge>
    );
  return <span className={cn(cell.kind === "number" && "tabular-nums")}>{cell.text}</span>;
}

/** A table of the fields a public layout names; the data table adds search and pages over them. */
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
  const size = pageSize ?? matching.length ?? 1;
  const pages = Math.max(1, Math.ceil(matching.length / Math.max(1, size)));
  const at = Math.min(page, pages - 1);
  const shown = pageSize ? matching.slice(at * size, (at + 1) * size) : matching;
  return (
    <PartCard
      title={title}
      description={searchable ? `${matching.length} of ${total}` : `${total} in total`}
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
      footer={pageSize ? <Pager at={at} pages={pages} onPage={setPage} /> : undefined}
      contentClassName="px-0"
    >
      {shown.length ? (
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((c) => (
                <TableHead key={c.id} className="first:pl-6 last:pr-6">
                  {c.name}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r) => (
              <TableRow key={r.id}>
                {r.cells.map((c) => (
                  <TableCell key={c.fieldId} className="max-w-[260px] truncate first:pl-6 last:pr-6">
                    <CellValue cell={c} />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <div className="px-6">
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
    <PartCard title={title} description={`${total} in total`} contentClassName="px-3">
      {items.length ? (
        <ItemGroup>
          {items.map((it) => (
            <Item key={it.id} size="sm">
              <ItemMedia>
                <Avatar className="size-8">
                  {it.image ? <AvatarImage src={it.image} alt="" /> : null}
                  <AvatarFallback>{initials(it.title)}</AvatarFallback>
                </Avatar>
              </ItemMedia>
              <ItemContent>
                <ItemTitle>{it.title}</ItemTitle>
                {it.description ? <ItemDescription>{it.description}</ItemDescription> : null}
              </ItemContent>
              {it.badge ? (
                <ItemActions>
                  <CellValue cell={it.badge} />
                </ItemActions>
              ) : null}
            </Item>
          ))}
        </ItemGroup>
      ) : (
        <div className="px-3">
          <Nothing />
        </div>
      )}
    </PartCard>
  );
}
