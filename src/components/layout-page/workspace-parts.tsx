"use client";

import { ViewRenderer } from "@/components/views/view-renderer";
import { AgendaWidget } from "@/components/widgets/agenda-widget";
import { ChartWidget } from "@/components/widgets/chart-widget";
import { HeatmapWidget } from "@/components/widgets/heatmap-widget";
import { ListWidget } from "@/components/widgets/list-widget";
import { ProgressWidget } from "@/components/widgets/progress-widget";
import { StatStrip } from "@/components/widgets/stat-strip";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useViewHref } from "./shared";

/** A slim title row over an embedded tab or form, the height of the dashboard's. */
function Titled({ title, height, children }: { title: string; height?: number; children: React.ReactNode }) {
  return (
    <section className="flex h-full min-w-0 flex-col bg-background">
      <header className="flex h-11 shrink-0 items-center border-b px-5 text-[13.5px] font-semibold">
        {title}
      </header>
      <div className="flex min-h-0 flex-col overflow-hidden" style={height ? { height } : undefined}>
        {children}
      </div>
    </section>
  );
}

/** An existing tab (table, board, calendar, schedule, register...) shown inside the layout as it is. */
export function ViewPart({ props }: { props: { viewId: string; height: number } }) {
  const { blueprint } = useWorkspace();
  const view = blueprint.views.find((v) => v.id === props.viewId);
  if (!view || view.type === "layout") return null;
  return (
    <Titled title={view.name} height={props.height}>
      <ViewRenderer view={view} />
    </Titled>
  );
}

/** A form of this workspace in place: in the app, the form itself (team members add records with it). */
export function FormPart({ props }: { props: { viewId: string; title?: string } }) {
  const { blueprint } = useWorkspace();
  const view = blueprint.views.find((v) => v.id === props.viewId);
  if (view?.type !== "form") return null;
  return (
    <Titled title={props.title ?? view.name}>
      <ViewRenderer view={view} />
    </Titled>
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
  return <div className="h-full min-w-0 bg-background [&_dl]:border-b-0">{body}</div>;
}
