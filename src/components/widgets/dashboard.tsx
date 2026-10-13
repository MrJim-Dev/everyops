"use client";

import { useWorkspace } from "@/components/workspace/workspace-context";
import type { System, Widget } from "@/lib/blueprint/types";
import { cn } from "@/lib/utils";
import { ChartWidget } from "./chart-widget";
import { ListWidget } from "./list-widget";
import { ProgressWidget } from "./progress-widget";
import { StatStrip } from "./stat-strip";

const spanOf = (w: Widget) => w.span ?? (w.type === "chart" ? "main" : "side");

/** Stats across the top, then a main column (charts) and a side column (lists, progress). */
export function Dashboard({ system }: { system: System }) {
  const { blueprint, basePath } = useWorkspace();
  const widgets = system.widgetIds
    .map((id) => blueprint.widgets.find((w) => w.id === id))
    .filter((w): w is Widget => !!w);
  const stats = widgets.filter((w) => w.type === "stat");
  const rest = widgets.filter((w) => w.type !== "stat");
  const main = rest.filter((w) => spanOf(w) === "main");
  const side = rest.filter((w) => spanOf(w) === "side");

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
      default:
        return null;
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      {stats.length ? <StatStrip widgets={stats} /> : null}
      <div
        className={cn(
          "grid grid-cols-1",
          main.length && side.length && "xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]",
        )}
      >
        {main.length ? (
          <div className="flex flex-col divide-y border-b xl:border-b-0">{main.map(render)}</div>
        ) : null}
        {side.length ? (
          <div className={cn("flex flex-col divide-y", main.length && "xl:border-l")}>{side.map(render)}</div>
        ) : null}
      </div>
    </div>
  );
}
