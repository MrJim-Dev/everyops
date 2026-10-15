"use client";

import { GlobeIcon, LockSimpleIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import { Component, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { PublicBar } from "@/components/views/public-bar";
import { useWorkspace } from "@/components/workspace/workspace-context";
import type { LayoutItem, LayoutSection, LayoutView as LayoutViewType } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { describeEdits } from "@/lib/components/layout-edit";
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
import { LayoutEditor } from "./layout-editor";
import { PartGrid } from "./shared";
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

/**
 * A section like a stretch of the dashboard: a small label, then its parts edge to edge with hairlines between them.
 */
function Section({ section, first }: { section: LayoutSection; first: boolean }) {
  const head = section.title || section.description;
  return (
    <section className="flex flex-col">
      {head ? (
        <header className={cn("flex items-baseline gap-2 px-5 pt-5 pb-2", !first && "border-t")}>
          {section.title ? (
            <h2 className="text-[11.5px] font-medium uppercase tracking-wide text-muted-foreground">
              {section.title}
            </h2>
          ) : null}
          {section.description ? (
            <p className="truncate text-[12px] text-muted-foreground/80">{section.description}</p>
          ) : null}
        </header>
      ) : null}
      <PartGrid
        items={section.items}
        columns={section.columns}
        className={cn("border-b", head && "border-t", !head && !first && "border-t")}
        render={(item) => <LayoutItemView item={item} />}
      />
    </section>
  );
}

/**
 * A page composed from the component library, section by section. On phones every part stacks. Managers can Edit
 * layout: rearrange, resize, remove and add parts and sections as a draft, saved as one change they can undo.
 */
export function LayoutView({ view }: { view: LayoutViewType }) {
  const ws = useWorkspace();
  const applyChange = useWorkspaces((s) => s.applyChange);
  const undoChange = useWorkspaces((s) => s.undoChange);
  const manager = ws.mode === "live" && canManage(ws.role);
  const [draft, setDraft] = useState<LayoutSection[] | null>(null);
  const save = () => {
    if (!draft) return;
    const sections = draft.filter((s) => s.items.length);
    const next = { ...view, sections };
    const bp = { ...ws.blueprint, views: ws.blueprint.views.map((v) => (v.id === view.id ? next : v)) };
    const prefix = `views.${bp.views.indexOf(next)}.`;
    const problems = validateBlueprint(bp).filter((e) => e.path.startsWith(prefix));
    if (problems.length) {
      toast.error("This layout can't be saved yet", { description: problems[0].message });
      return;
    }
    if (JSON.stringify(sections) !== JSON.stringify(view.sections)) {
      const entry = applyChange(ws.id, {
        request: `Edit the ${view.name} layout`,
        title: `Edit ${view.name}`,
        facts: [],
        steps: [{ kind: "change", label: view.name, detail: describeEdits(view.sections, sections) }],
        ops: [{ op: "replace_view", viewId: view.id, view: next }],
      });
      if (entry)
        toast.success(`${view.name} saved`, {
          description: "You can also undo it from History.",
          action: { label: "Undo", onClick: () => undoChange(ws.id, entry.id) },
        });
    }
    setDraft(null);
  };
  const editBar = draft ? (
    <div className="flex items-center gap-2 border-b bg-muted/30 px-4 py-1.5 text-[12.5px] text-muted-foreground">
      <PencilSimpleIcon aria-hidden="true" className="size-3.5" />
      <span className="mr-auto">Editing the layout. Nothing changes until you save.</span>
      <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
        Cancel
      </Button>
      <Button size="sm" onClick={save}>
        Save layout
      </Button>
    </div>
  ) : null;
  const editButton = (
    <Button size="sm" variant="ghost" onClick={() => setDraft(structuredClone(view.sections))}>
      <PencilSimpleIcon data-icon="inline-start" />
      Edit layout
    </Button>
  );
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
      {editBar ??
        (view.public ? (
          <>
            <PublicBar view={view} />
            {manager ? <div className="flex justify-end border-b px-4 py-1">{editButton}</div> : null}
          </>
        ) : manager ? (
          <div className="flex items-center justify-end gap-2 border-b px-4 py-1.5 text-[12.5px] text-muted-foreground">
            <LockSimpleIcon aria-hidden="true" className="size-3.5" />
            <span className="mr-auto">Only your team can see this page.</span>
            {editButton}
            <Button size="sm" variant="ghost" onClick={publish}>
              <GlobeIcon data-icon="inline-start" />
              Make public
            </Button>
          </div>
        ) : null)}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {draft ? (
          <LayoutEditor
            view={view}
            sections={draft}
            onChange={setDraft}
            renderItem={(item) => <LayoutItemView item={item} />}
          />
        ) : (
          <div className="flex w-full flex-col pb-6">
            {view.sections.map((s, i) => (
              <Section key={s.id} section={s} first={i === 0} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
