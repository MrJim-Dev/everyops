"use client";

import { Card } from "@/components/ui/card";
import { ViewRenderer } from "@/components/views/view-renderer";
import { AgendaWidget } from "@/components/widgets/agenda-widget";
import { ChartWidget } from "@/components/widgets/chart-widget";
import { HeatmapWidget } from "@/components/widgets/heatmap-widget";
import { ListWidget } from "@/components/widgets/list-widget";
import { ProgressWidget } from "@/components/widgets/progress-widget";
import { StatStrip } from "@/components/widgets/stat-strip";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useViewHref } from "./shared";

/** An existing tab (table, board, calendar, schedule, register, form...) shown inside the layout as it is. */
export function ViewPart({ props }: { props: { viewId: string; height: number } }) {
  const { blueprint } = useWorkspace();
  const view = blueprint.views.find((v) => v.id === props.viewId);
  if (!view || view.type === "layout") return null;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="flex h-10 items-center border-b px-4 text-[13px] font-medium">{view.name}</div>
      <div className="flex min-h-0 flex-col overflow-hidden" style={{ height: props.height }}>
        <ViewRenderer view={view} />
      </div>
    </Card>
  );
}

/** An existing dashboard card, drawn by the same component as on its dashboard. */
export function WidgetPart({ props }: { props: { widgetId: string } }) {
  const { blueprint } = useWorkspace();
  const hrefFor = useViewHref();
  const widget = blueprint.widgets.find((w) => w.id === props.widgetId);
  if (!widget) return null;
  const href = hrefFor(widget.list?.viewId);
  const body = (() => {
    switch (widget.type) {
      case "stat":
        return <StatStrip widgets={[widget]} />;
      case "chart":
        return <ChartWidget widget={widget} />;
      case "progress":
        return <ProgressWidget widget={widget} />;
      case "list":
        return <ListWidget widget={widget} viewHref={href} />;
      case "agenda":
        return <AgendaWidget widget={widget} viewHref={href} />;
      case "heatmap":
        return <HeatmapWidget widget={widget} />;
    }
  })();
  return <Card className="h-full gap-0 overflow-hidden py-0 [&_dl]:border-b-0">{body}</Card>;
}
