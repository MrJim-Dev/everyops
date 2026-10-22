"use client";

import {
  ArrowLeftIcon,
  ClockCounterClockwiseIcon,
  FoldersIcon,
  GearSixIcon,
  GlobeSimpleIcon,
  MagnifyingGlassIcon,
  SidebarSimpleIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { UserMenu } from "@/components/auth/user-menu";
import { UseSystemButton } from "@/components/community/use-system-dialog";
import { isSitePage } from "@/components/setup/build-model";
import { BuildPages } from "@/components/setup/build-sidebar";
import { SystemIcon } from "@/components/system-icon";
import { Kbd } from "@/components/ui/kbd";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useAssistant } from "@/lib/assistant/panel-store";
import type { Blueprint, System } from "@/lib/blueprint/types";
import { useBuildOf, useSetupSketch } from "@/lib/store/setup-build";
import { usePageGroups, useSidebar } from "@/lib/store/sidebar";
import { canManage } from "@/lib/store/workspaces";
import { cn } from "@/lib/utils";
import { useCommandMenu } from "./command-menu";
import { NotificationsButton } from "./notifications-button";
import { OrganizePagesDialog } from "./organize-pages";
import { RailTip } from "./rail-tip";
import {
  ACTIVE_ITEM,
  PageGroup,
  RAIL_ITEM,
  RAIL_LABEL,
  railWidth,
  SidebarLink,
  SidebarSection,
} from "./sidebar-link";
import { WorkspaceSwitcher } from "./workspace-switcher";

/** More pages than this and groups without the current page start closed, and an ungrouped list offers grouping. */
const LONG_LIST = 8;

/** Pages in order, with each group listed in full where its first page is. */
function sidebarEntries(systems: System[]) {
  const entries: ({ page: System } | { group: string; pages: System[] })[] = [];
  for (const s of systems) {
    if (!s.group) entries.push({ page: s });
    else if (!entries.some((e) => "group" in e && e.group === s.group))
      entries.push({ group: s.group, pages: systems.filter((x) => x.group === s.group) });
  }
  return entries;
}

/** A page made only of public website pages: listed under Website, apart from the systems the team works in. */
function isWebsite(bp: Blueprint, system: System) {
  const views = system.viewIds.map((id) => bp.views.find((v) => v.id === id));
  return (
    !system.widgetIds.length &&
    views.length > 0 &&
    views.every((v) => v?.type === "landing" || (v?.type === "html" && v.public))
  );
}

/**
 * The workspace sidebar. Its content is laid out at full width and never reflows: collapsing narrows
 * the frame around it (see WorkspaceShell), labels fade, and icons stay exactly where they were.
 * `rail` is false in the mobile sheet, where there's nothing to collapse.
 */
export function WorkspaceSidebar({ onNavigate, rail = false }: { onNavigate?: () => void; rail?: boolean }) {
  const ws = useWorkspace();
  const pathname = usePathname();
  const { setOpen } = useCommandMenu();
  const assistantOpen = useAssistant((s) => s.open);
  const toggleAssistant = useAssistant((s) => s.toggle);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const onAsk = isActive(`${ws.basePath}/ask`);
  const website = ws.blueprint.systems.filter((s) => isWebsite(ws.blueprint, s));
  const systems = ws.blueprint.systems.filter((s) => !website.includes(s));
  const toggleSidebar = useSidebar((s) => s.toggle);
  const openGroups = usePageGroups((s) => s.open);
  const setGroupOpen = usePageGroups((s) => s.setOpen);
  const [organizing, setOrganizing] = useState(false);
  const organizer = ws.mode === "live" && canManage(ws.role);
  const collapsible = onNavigate === undefined;
  // A workspace being set up: its pages land here as Gemini designs them, and the draft's stay until it's created.
  const setupSketch = useSetupSketch(ws.id);
  const setupBuild = useBuildOf(ws.id);
  const setup = !ws.blueprint.systems.length && (!!setupSketch || !!setupBuild);
  const setupSite = setup && !!setupSketch?.pages.some(isSitePage);
  // Website pages show a globe whatever icon they were saved with (often a house, which read as a second home).
  const systemLink = (system: System, site = false) => {
    const href = `${ws.basePath}/${system.id}`;
    return (
      <SidebarLink
        key={system.id}
        href={href}
        active={isActive(href)}
        icon={site ? <GlobeSimpleIcon /> : <SystemIcon name={system.icon} />}
        onNavigate={onNavigate}
        rail={rail}
      >
        {system.name}
      </SidebarLink>
    );
  };
  const pageList = (): ReactNode =>
    sidebarEntries(systems).map((entry) => {
      if ("page" in entry) return systemLink(entry.page);
      const key = `${ws.id}:${entry.group}`;
      const current = entry.pages.some((s) => isActive(`${ws.basePath}/${s.id}`));
      const open = openGroups[key] ?? (systems.length <= LONG_LIST || current);
      return (
        <PageGroup
          key={`group:${entry.group}`}
          name={entry.group}
          open={open}
          onToggle={() => setGroupOpen(key, !open)}
          count={entry.pages.length}
          current={current}
          rail={rail}
        >
          {entry.pages.map((s) => systemLink(s))}
        </PageGroup>
      );
    });

  return (
    <nav
      aria-label="Workspace"
      data-rail={rail}
      className={cn(
        "group/sidebar flex h-full flex-col gap-1 px-2.5 py-2.5",
        collapsible ? "w-[232px]" : "w-full",
      )}
    >
      <div className="flex items-center gap-1">
        {ws.mode === "live" ? (
          <div className={cn("flex overflow-clip rounded-md", RAIL_ITEM, rail ? "w-8" : "w-full")}>
            <WorkspaceSwitcher />
          </div>
        ) : (
          <Link
            href="/community"
            className="flex h-9 flex-1 items-center gap-2 rounded-md px-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-foreground"
          >
            <ArrowLeftIcon className="size-3.5" />
            Community systems
          </Link>
        )}
      </div>

      <div className="mt-1 flex flex-col gap-px">
        <RailTip rail={rail} label="Search">
          <button
            type="button"
            aria-label={rail ? "Search" : undefined}
            onClick={() => setOpen(true)}
            className={cn(
              "flex h-8 items-center gap-2.5 overflow-hidden rounded-md px-2 text-[13px] whitespace-nowrap text-sidebar-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
              RAIL_ITEM,
              railWidth(rail),
            )}
          >
            <MagnifyingGlassIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className={cn("flex-1 text-left", RAIL_LABEL)}>Search</span>
            <Kbd className={RAIL_LABEL}>⌘K</Kbd>
          </button>
        </RailTip>
        {ws.mode === "live" ? (
          <>
            <NotificationsButton rail={rail} />
            {/*
              One way in for everyone: the panel beside the page. Owners and admins can expand it to the full
              Ask EveryOps page, which is the same conversation; it's highlighted there too.
            */}
            <RailTip rail={rail} label="Ask EveryOps">
              <button
                type="button"
                aria-label={rail ? "Ask EveryOps" : undefined}
                aria-pressed={assistantOpen || onAsk}
                data-active={assistantOpen || onAsk}
                onClick={() => {
                  if (!onAsk) toggleAssistant();
                  onNavigate?.();
                }}
                className={cn(
                  "flex h-8 items-center gap-2.5 overflow-hidden rounded-md px-2 text-[13px] whitespace-nowrap text-sidebar-foreground outline-none hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 data-[active=true]:hover:bg-transparent",
                  ACTIVE_ITEM,
                  RAIL_ITEM,
                  railWidth(rail),
                )}
              >
                <SparkleIcon className="size-4 shrink-0 text-muted-foreground" />
                <span className={cn("flex-1 text-left", RAIL_LABEL)}>Ask EveryOps</span>
                <Kbd className={RAIL_LABEL}>⌘J</Kbd>
              </button>
            </RailTip>
            <SidebarLink
              href={`${ws.basePath}/history`}
              active={isActive(`${ws.basePath}/history`)}
              icon={<ClockCounterClockwiseIcon />}
              onNavigate={onNavigate}
              rail={rail}
            >
              History
            </SidebarLink>
            <SidebarLink
              href={`${ws.basePath}/settings`}
              active={isActive(`${ws.basePath}/settings`)}
              icon={<GearSixIcon />}
              onNavigate={onNavigate}
              rail={rail}
            >
              Settings
            </SidebarLink>
          </>
        ) : null}
      </div>

      {/*
        The pages scroll on their own when there are more than fit, so search above and the account below stay put.
        It reaches the sidebar's edges (padding put back inside) so the scrollbar sits at the edge and focus rings aren't cut.
      */}
      <div className="-mx-2.5 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-contain px-2.5 pb-px [scrollbar-width:thin]">
        <SidebarSection
          label="Systems"
          action={
            organizer && systems.length > 1 ? (
              <button
                type="button"
                aria-label="Organize pages"
                title="Organize pages"
                onClick={() => setOrganizing(true)}
                className="flex size-6 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <FoldersIcon className="size-3.5" />
              </button>
            ) : undefined
          }
        >
          {setup ? (
            <BuildPages workspaceId={ws.id} rail={rail} />
          ) : systems.length === 0 ? (
            <p className="px-2 py-1 text-[12px] leading-relaxed text-muted-foreground">
              Your systems will appear here once EveryOps sets them up.
            </p>
          ) : (
            pageList()
          )}
          {organizer && !setup && systems.length > LONG_LIST && !systems.some((s) => s.group) ? (
            <RailTip rail={rail} label="Group these pages">
              <button
                type="button"
                aria-label={rail ? "Group these pages" : undefined}
                onClick={() => setOrganizing(true)}
                className={cn(
                  "flex h-8 items-center gap-2.5 overflow-hidden rounded-md px-2 text-[12.5px] whitespace-nowrap text-muted-foreground outline-none hover:bg-sidebar-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                  RAIL_ITEM,
                  railWidth(rail),
                )}
              >
                <FoldersIcon className="size-4 shrink-0" />
                <span className={cn("flex-1 text-left", RAIL_LABEL)}>Group these pages</span>
              </button>
            </RailTip>
          ) : null}
        </SidebarSection>
        {website.length ? (
          <SidebarSection label="Website">{website.map((s) => systemLink(s, true))}</SidebarSection>
        ) : setupSite ? (
          <SidebarSection label="Website">
            <BuildPages workspaceId={ws.id} rail={rail} site />
          </SidebarSection>
        ) : null}
      </div>

      <div className={cn("flex shrink-0 flex-col gap-2", rail ? "pt-[52px]" : "pt-4")}>
        {ws.mode === "preview" ? (
          <div
            className={cn(
              "flex flex-col gap-2 rounded-lg border border-sidebar-border p-3",
              RAIL_LABEL,
              rail && "pointer-events-none",
            )}
            aria-hidden={rail || undefined}
          >
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {ws.records.length
                ? `You're previewing ${ws.name} with sample data. Changes here aren't saved.`
                : `You're previewing ${ws.name}. It starts empty, and changes here aren't saved.`}
            </p>
            <UseSystemButton systemId={ws.id} />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <div className={cn("flex min-w-0 overflow-clip rounded-md", RAIL_ITEM, rail ? "w-8" : "flex-1")}>
            <UserMenu variant="sidebar" />
          </div>
          {collapsible ? (
            <RailTip
              rail={rail}
              label={
                <>
                  Expand sidebar <Kbd>⌘B</Kbd>
                </>
              }
            >
              <button
                type="button"
                aria-label={rail ? "Expand sidebar" : "Collapse sidebar"}
                aria-expanded={!rail}
                title={rail ? undefined : "Collapse sidebar (⌘B)"}
                onClick={() => toggleSidebar(rail)}
                className={cn(
                  // In the rail the button glides to the column above your avatar, along with the frame.
                  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-[transform,color,background-color] duration-[260ms] ease-(--ease-drawer) hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 group-data-[instant=true]/shell:duration-0",
                  rail && "-translate-x-[182px] -translate-y-10",
                )}
              >
                <SidebarSimpleIcon className="size-4" />
              </button>
            </RailTip>
          ) : null}
        </div>
      </div>
      {organizer ? (
        <OrganizePagesDialog open={organizing} onOpenChange={setOrganizing} pages={systems} />
      ) : null}
    </nav>
  );
}
