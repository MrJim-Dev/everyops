"use client";

import { useWorkspace } from "@/components/workspace/workspace-context";
import type { DashboardLayout, System, Widget, WidgetWidth } from "@/lib/blueprint/types";
import { cn } from "@/lib/utils";
import { AgendaWidget } from "./agenda-widget";
import { ChartWidget } from "./chart-widget";
import { DashboardSuggestions } from "./dashboard-suggestions";
import { HeatmapWidget } from "./heatmap-widget";
import { ListWidget } from "./list-widget";
import { ProgressWidget } from "./progress-widget";
import { StatStrip } from "./stat-strip";

const spanOf = (w: Widget) => w.span ?? (w.type === "chart" ? "main" : "side");

/** Default widths and order for each premade layout. Lower order comes first. */
const LAYOUTS: Record<DashboardLayout, Record<Widget["type"], { width: WidgetWidth; order: number }>> = {
  overview: {
    stat: { width: "third", order: 0 },
    chart: { width: "two_thirds", order: 1 },
    list: { width: "third", order: 1 },
    agenda: { width: "third", order: 1 },
    progress: { width: "third", order: 2 },
    heatmap: { width: "full", order: 3 },
  },
  operations: {
    stat: { width: "third", order: 0 },
    agenda: { width: "two_thirds", order: 1 },
    list: { width: "third", order: 2 },
    progress: { width: "third", order: 3 },
    chart: { width: "half", order: 4 },
    heatmap: { width: "full", order: 5 },
  },
  reports: {
    stat: { width: "third", order: 0 },
    chart: { width: "half", order: 1 },
    heatmap: { width: "full", order: 2 },
    progress: { width: "third", order: 3 },
    list: { width: "third", order: 3 },
    agenda: { width: "third", order: 3 },
  },
};

const SPAN: Record<WidgetWidth, string> = {
  third: "lg:col-span-2",
  half: "lg:col-span-3",
  two_thirds: "lg:col-span-4",
  full: "lg:col-span-6",
};

/**
 * Stats across the top, then the other widgets. With a layout (or widths), a six-column grid separated by
 * hairlines; without one, charts in a main column and lists and progress at the side.
 */
export function Dashboard({ system }: { system: System }) {
  const { blueprint, basePath } = useWorkspace();
  const widgets = system.widgetIds
    .map((id) => blueprint.widgets.find((w) => w.id === id))
    .filter((w): w is Widget => !!w);
  const stats = widgets.filter((w) => w.type === "stat");
  const rest = widgets.filter((w) => w.type !== "stat");

  const hrefFor = (w: Widget) => {
    const viewId = w.list?.viewId;
    const owner = viewId ? blueprint.systems.find((s) => s.viewIds.includes(viewId)) : undefined;
    return owner && viewId ? `${basePath}/${owner.id}/${viewId}` : undefined;
  };
  const render = (w: Widget) => {
    switch (w.type) {
      case "chart":
        return <ChartWidget key={w.id} widget={w} />;
      case "progress":
        return <ProgressWidget key={w.id} widget={w} />;
      case "list":
        return <ListWidget key={w.id} widget={w} viewHref={hrefFor(w)} />;
      case "agenda":
        return <AgendaWidget key={w.id} widget={w} viewHref={hrefFor(w)} />;
      case "heatmap":
        return <HeatmapWidget key={w.id} widget={w} />;
      default:
        return null;
    }
  };

  const layout = system.layout ?? (rest.some((w) => w.width) ? "overview" : undefined);
  if (layout) {
    const plan = LAYOUTS[layout];
    const placed = rest
      .map((w, i) => ({ w, i, ...plan[w.type], width: w.width ?? plan[w.type].width }))
      .sort((a, b) => a.order - b.order || a.i - b.i);
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <DashboardSuggestions system={system} />
        {stats.length ? <StatStrip widgets={stats} /> : null}
        {placed.length ? (
          <div className="grid grid-flow-row-dense grid-cols-1 gap-px border-b bg-border lg:grid-cols-6">
            {placed.map(({ w, width }) => (
              <div key={w.id} className={cn("min-w-0 bg-background", SPAN[width])}>
                {render(w)}
              </div>
            ))}
          </div>
        ) : null}
      </div>
    );
  }

  const main = rest.filter((w) => spanOf(w) === "main");
  const side = rest.filter((w) => spanOf(w) === "side");
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <DashboardSuggestions system={system} />
      {stats.length ? <StatStrip widgets={stats} /> : null}
      <div
        className={cn(
          "grid grid-cols-1",
          main.length && side.length && "xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]",
        )}
      >
        {main.length ? (
          // A page of only charts (a reports page) uses two columns on wide screens.
          <div
            className={cn(
              "flex flex-col divide-y border-b xl:border-b-0",
              !side.length &&
                main.length > 1 &&
                "xl:grid xl:grid-cols-2 xl:divide-y-0 xl:[&>*]:border-b xl:[&>*:nth-child(odd)]:border-r",
            )}
          >
            {main.map(render)}
          </div>
        ) : null}
        {side.length ? (
          <div className={cn("flex flex-col divide-y", main.length && "xl:border-l")}>{side.map(render)}</div>
        ) : null}
      </div>
    </div>
  );
}
