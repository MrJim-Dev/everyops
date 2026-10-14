"use client";

import { GlobeIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { Component, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PublicBar } from "@/components/views/public-bar";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { LayoutItem, LayoutSection, LayoutView as LayoutViewType } from "@/lib/blueprint/types";
import { layoutPublicProblems } from "@/lib/components/public-safety";
import { componentDef } from "@/lib/components/registry";
import { canManage, useWorkspaces } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import {
  AccordionPart,
  AlertPart,
  ButtonPart,
  CardPart,
  HeadingPart,
  SeparatorPart,
  TabsPart,
  TextPart,
} from "./basics";
import {
  ChartInteractivePart,
  DataTablePart,
  LeaderboardPart,
  StatCardsPart,
  StatusOverviewPart,
} from "./blocks";
import { CartesianPart, PiePart, RadarPart, RadialPart } from "./charts";
import {
  AvatarsPart,
  BadgesPart,
  CalendarPart,
  CarouselPart,
  ListPart,
  ProgressPart,
  StatPart,
  TablePart,
} from "./data";
import { FormPart, ViewPart, WidgetPart } from "./workspace-parts";

// biome-ignore lint/suspicious/noExplicitAny: each renderer gets the settings its registry schema produced
type Renderer = (props: { props: any; renderItem: (item: LayoutItem) => ReactNode }) => ReactNode;

/** The component library's renderers, by registry id. */
export const RENDERERS: Record<string, Renderer> = {
  heading: HeadingPart,
  text: TextPart,
  card: CardPart,
  alert: AlertPart,
  separator: SeparatorPart,
  button: ButtonPart,
  accordion: AccordionPart,
  tabs: TabsPart,
  stat: StatPart,
  progress: ProgressPart,
  table: TablePart,
  list: ListPart,
  avatars: AvatarsPart,
  badges: BadgesPart,
  calendar: CalendarPart,
  carousel: CarouselPart,
  chart_area: (p) => <CartesianPart {...p} kind="area" />,
  chart_bar: (p) => <CartesianPart {...p} kind="bar" />,
  chart_line: (p) => <CartesianPart {...p} kind="line" />,
  chart_pie: PiePart,
  chart_radar: RadarPart,
  chart_radial: RadialPart,
  stat_cards: StatCardsPart,
  chart_interactive: ChartInteractivePart,
  data_table: DataTablePart,
  leaderboard: LeaderboardPart,
  status_overview: StatusOverviewPart,
  form: FormPart,
  view: ViewPart,
  widget: WidgetPart,
};

/** Static classes so Tailwind keeps them: columns per section and how far an item spans. */
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

/** One broken part shows a quiet note instead of taking the whole page down. */
class PartBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <div className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">
          {this.props.name} couldn't be shown. Ask EveryOps to fix this part.
        </div>
      );
    return this.props.children;
  }
}

export function LayoutItemView({ item }: { item: LayoutItem }) {
  const d = componentDef(item.component);
  const Render = RENDERERS[item.component];
  if (!d || !Render) return null;
  const parsed = d.props.safeParse(item.props);
  return (
    <PartBoundary name={d.name}>
      {parsed.success ? (
        <Render props={parsed.data} renderItem={(x) => <LayoutItemView item={x} />} />
      ) : (
        <div className="rounded-xl border border-dashed p-4 text-[13px] text-muted-foreground">
          {d.name} needs fixing. Ask EveryOps to fix this part.
        </div>
      )}
    </PartBoundary>
  );
}

function Section({ section }: { section: LayoutSection }) {
  const columns = Math.min(4, Math.max(1, section.columns || 1));
  return (
    <section className="flex flex-col gap-3">
      {section.title || section.description ? (
        <header className="flex flex-col gap-0.5">
          {section.title ? <h2 className="text-[15px] font-semibold">{section.title}</h2> : null}
          {section.description ? (
            <p className="text-[13px] text-muted-foreground">{section.description}</p>
          ) : null}
        </header>
      ) : null}
      <div className={cn("grid grid-cols-1 gap-4", COLS[columns])}>
        {section.items.map((item) => {
          const wide = componentDef(item.component)?.wide;
          const span = Math.min(columns, item.span ?? (wide ? columns : 1));
          return (
            <div key={item.id} className={cn("min-w-0", SPAN[span])}>
              <LayoutItemView item={item} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** A page composed from the component library, section by section. On phones every part stacks. */
export function LayoutView({ view }: { view: LayoutViewType }) {
  const ws = useWorkspace();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const manager = ws.mode === "live" && canManage(ws.role);
  // Publishing checks the page first: parts that would show people or the team's own screens stay team-only.
  const publish = () => {
    const problems = layoutPublicProblems(ws.blueprint, view);
    if (problems.length) {
      toast.error("This page can't be public yet", {
        description: `${problems[0]}${problems.length > 1 ? ` (and ${problems.length - 1} more)` : ""}. Ask EveryOps to make a public version.`,
      });
      return;
    }
    const entry = applyChange(ws.id, {
      request: `Publish ${view.name}`,
      title: `Publish ${view.name}`,
      facts: [],
      steps: [{ kind: "change", label: view.name, detail: "Team only → Public" }],
      ops: [{ op: "update_view", viewId: view.id, patch: { public: true } }],
    });
    if (entry) toast.success(`${view.name} is public`);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {view.public ? (
        <PublicBar view={view} />
      ) : manager ? (
        <div className="flex items-center justify-end gap-2 border-b px-4 py-1.5 text-[12.5px] text-muted-foreground">
          <LockSimpleIcon aria-hidden="true" className="size-3.5" />
          <span className="mr-auto">Only your team can see this page.</span>
          <Button size="sm" variant="ghost" onClick={publish}>
            <GlobeIcon data-icon="inline-start" />
            Make public
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 p-4 sm:p-6">
          {view.sections.map((s) => (
            <Section key={s.id} section={s} />
          ))}
        </div>
      </div>
    </div>
  );
}
