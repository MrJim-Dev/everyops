"use client";

import { PlusIcon, SparkleIcon } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ViewTabs } from "@/components/motion/view-tabs";
import { useRecordPanels } from "@/components/records/record-panels";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { ViewEmpty } from "@/components/views/view-empty";
import { CREATABLE, ViewRenderer } from "@/components/views/view-renderer";
import { Dashboard } from "@/components/widgets/dashboard";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useAssistant } from "@/lib/assistant/panel-store";
import { findEntity, getSystem, getView } from "@/lib/blueprint/lookup";
import type { View } from "@/lib/blueprint/types";
import { layoutItems } from "@/lib/components/registry";
import { canEdit } from "@/lib/store/workspaces";

/** The tab of a page's dashboard cards, when the page also has tabs (see SystemPage). */
const DASHBOARD_TAB = "_dashboard";

/** The tab named in the URL after the page's own path, e.g. "all_bookings" in /w/court/bookings/all_bookings. */
function tabInPath(pathname: string, pagePath: string): string | undefined {
  if (!pathname.startsWith(`${pagePath}/`)) return undefined;
  const rest = pathname.slice(pagePath.length + 1).split("/")[0];
  return rest ? decodeURIComponent(rest) : undefined;
}

/**
 * One system page: header, view tabs, and the active view or dashboard. The active tab comes from the URL, which
 * the tabs change in place (see ViewTabs inPlace), so switching tabs is instant and keeps one copy of the page.
 */
export function SystemPage({ systemId, viewId }: { systemId?: string; viewId?: string }) {
  const ws = useWorkspace();
  const pathname = usePathname();
  const { openCreate } = useRecordPanels();
  const assistantOpen = useAssistant((s) => s.open);
  const openAssistant = useAssistant((s) => s.setOpen);
  const system = systemId ? getSystem(ws.blueprint, systemId) : ws.blueprint.systems[0];
  const pagePath = system ? `${ws.basePath}/${system.id}` : "";
  const wanted = system
    ? (tabInPath(pathname, pagePath) ?? (pathname === pagePath ? undefined : viewId))
    : viewId;
  const views = system
    ? system.viewIds.map((id) => getView(ws.blueprint, id)).filter((v): v is View => !!v)
    : [];
  // Dashboard cards on a page that also has tabs used to be hidden behind them. Cards no layout tab of the page shows
  // get a Dashboard tab of their own, last, so nothing on a page is ever out of reach.
  const placed = new Set(
    views.flatMap((v) =>
      v.type === "layout"
        ? layoutItems(v.sections).flatMap(({ item }) =>
            item.component === "widget" ? [String(item.props.widgetId)] : [],
          )
        : [],
    ),
  );
  const loose = system && views.length ? system.widgetIds.filter((id) => !placed.has(id)) : [];
  // The page opens on its first tab (the layout, on an Overview); the leftover cards open only when asked for.
  const onDashboard = loose.length > 0 && wanted === DASHBOARD_TAB;
  // The tab shown last, so a plan that swaps it for another layout keeps showing that place.
  const last = useRef<{ id: string; index: number } | null>(null);
  const swapped = wanted && last.current?.id === wanted ? views[last.current.index] : undefined;
  const active = onDashboard ? undefined : (views.find((v) => v.id === wanted) ?? swapped ?? views[0]);
  useEffect(() => {
    if (active) last.current = { id: active.id, index: views.indexOf(active) };
  });
  // A tab that no longer exists (a plan removed or replaced it) leaves the URL on the tab shown instead.
  const stale = !!wanted && !!active && active.id !== wanted && !onDashboard;
  useEffect(() => {
    if (stale && active) window.history.replaceState(null, "", `${pagePath}/${active.id}`);
  }, [stale, active, pagePath]);

  if (!system) {
    return (
      <ViewEmpty
        title="This page doesn't exist"
        description="The system may have been renamed or removed. Pick one from the sidebar."
      />
    );
  }

  const entity = active ? findEntity(ws.blueprint, active.entityId) : undefined;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={system.name}
        actions={
          <>
            {ws.mode === "live" && !assistantOpen ? (
              <Button variant="ghost" size="sm" onClick={() => openAssistant(true)}>
                <SparkleIcon data-icon="inline-start" />
                Ask EveryOps
              </Button>
            ) : null}
            {active && entity && CREATABLE.includes(active.type) && canEdit(ws.role) ? (
              <Button size="sm" onClick={() => openCreate(entity.id)}>
                <PlusIcon data-icon="inline-start" />
                New {entity.name.toLowerCase()}
              </Button>
            ) : null}
          </>
        }
      />
      {views.length + (loose.length ? 1 : 0) > 1 ? (
        <ViewTabs
          groupId={`${ws.id}:${system.id}`}
          label={`${system.name} views`}
          activeId={onDashboard ? DASHBOARD_TAB : active?.id}
          inPlace
          items={[
            ...views.map((view) => ({ id: view.id, href: `${pagePath}/${view.id}`, label: view.name })),
            ...(loose.length
              ? [{ id: DASHBOARD_TAB, href: `${pagePath}/${DASHBOARD_TAB}`, label: "Dashboard" }]
              : []),
          ]}
        />
      ) : (
        <div className="border-b" />
      )}
      {active ? (
        <ViewRenderer view={active} />
      ) : (
        <Dashboard system={loose.length ? { ...system, widgetIds: loose } : system} />
      )}
    </div>
  );
}
