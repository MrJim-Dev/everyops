"use client";

import { ListIcon, SparkleIcon } from "@phosphor-icons/react";
import { usePathname } from "next/navigation";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { RecordPanelsProvider } from "@/components/records/record-panels";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useHotkey } from "@/hooks/use-hotkey";
import { useAssistant } from "@/lib/assistant/panel-store";
import { useSidebar, useSidebarCollapsed } from "@/lib/store/sidebar";
import { cn } from "@/lib/utils";
import { CommandMenu, CommandMenuProvider } from "./command-menu";
import { WorkspaceSidebar } from "./workspace-sidebar";

/** Linear-style frame: a quiet sidebar on the shell, content in an inset panel, and the assistant on the right. */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const assistantOpen = useAssistant((s) => s.open);
  const assistantInstant = useAssistant((s) => s.instant);
  const setAssistantOpen = useAssistant((s) => s.setOpen);
  const toggleAssistant = useAssistant((s) => s.toggle);
  // The full Ask EveryOps page is the same conversation: the panel never opens beside it.
  const pathname = usePathname();
  const onAsk = pathname === `${ws.basePath}/ask`;
  // Arriving from a screen that faded out (home prompt, Create workspace): the page settles back in on the next
  // frame, through the same transition it left on.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-checked on every page change
  useEffect(() => {
    if (!("eoLeaving" in document.documentElement.dataset)) return;
    const frame = requestAnimationFrame(() => delete document.documentElement.dataset.eoLeaving);
    return () => cancelAnimationFrame(frame);
  }, [pathname]);
  useEffect(() => {
    const state = useAssistant.getState();
    if (onAsk && state.open) setAssistantOpen(false);
    if (!onAsk && state.openAfterAsk) {
      state.setOpenAfterAsk(false);
      setAssistantOpen(true);
    }
  }, [onAsk, setAssistantOpen]);
  // The panel stays mounted while it slides out, then unmounts.
  const [assistantMounted, setAssistantMounted] = useState(assistantOpen);
  useEffect(() => {
    if (assistantOpen) setAssistantMounted(true);
    else if (assistantInstant) setAssistantMounted(false);
  }, [assistantOpen, assistantInstant]);
  const live = ws.mode === "live";
  const rail = useSidebarCollapsed();
  const instant = useSidebar((s) => s.instant);
  const toggleSidebar = useSidebar((s) => s.toggle);
  // ⌘B is a keyboard shortcut people use constantly, so it switches instantly. Typing fields keep ⌘B.
  useHotkey(
    "b",
    useCallback(
      (event: KeyboardEvent) => {
        const el = event.target as HTMLElement | null;
        if (el?.closest("input, textarea, [contenteditable=true]")) return;
        toggleSidebar(rail, true);
      },
      [toggleSidebar, rail],
    ),
  );
  useHotkey(
    "j",
    // ⌘J is used constantly, so like ⌘B it opens and closes instantly.
    // On the Ask EveryOps page ⌘J is still caught (Chrome would open Downloads) but has nothing to open.
    useCallback(() => {
      if (!onAsk) toggleAssistant(true);
    }, [toggleAssistant, onAsk]),
    live,
  );

  return (
    <CommandMenuProvider>
      <div className="group/shell flex h-dvh bg-shell" data-instant={instant}>
        {/*
          The frame narrows; the sidebar inside keeps its width and is clipped, so nothing in it reflows.
          The main panel takes the space back in step. Width is the one property here with no transform
          equivalent, so it's kept short and on the drawer curve.
        */}
        <aside
          className={cn(
            "hidden shrink-0 overflow-clip transition-[width] duration-[260ms] ease-(--ease-drawer) group-data-[instant=true]/shell:duration-0 md:block",
            rail ? "w-[52px]" : "w-[232px]",
          )}
        >
          <WorkspaceSidebar rail={rail} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col md:py-2 md:pr-2">
          <div className="flex h-11 items-center gap-2 border-b px-3 md:hidden">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open navigation"
              onClick={() => setMobileOpen(true)}
            >
              <ListIcon />
            </Button>
            <span className="flex-1 truncate text-[13px] font-medium">{ws.name}</span>
            {live && !onAsk ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Ask EveryOps"
                onClick={() => toggleAssistant()}
              >
                <SparkleIcon />
              </Button>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 gap-2">
            <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background md:rounded-lg md:border">
              <RecordPanelsProvider>{children}</RecordPanelsProvider>
            </main>
            {/*
              Like the sidebar: the frame widens on the drawer curve while the panel inside, at its full width,
              slides in from the right and fades up, so the page makes room as the panel arrives. Closing runs the
              same path back. Keyboard toggles skip the motion.
            */}
            {live ? (
              <div
                inert={!assistantOpen}
                onTransitionEnd={(e) => {
                  if (e.target === e.currentTarget && !assistantOpen) setAssistantMounted(false);
                }}
                className={cn(
                  "-ml-2 hidden shrink-0 overflow-clip transition-[width] duration-[280ms] ease-(--ease-drawer) md:block",
                  assistantOpen ? "w-[388px]" : "w-0",
                  assistantInstant && "duration-0",
                )}
              >
                {assistantMounted ? (
                  <div className="h-full w-[388px] pl-2">
                    <AssistantPanel
                      onClose={() => setAssistantOpen(false)}
                      className={cn(
                        "flex h-full w-[380px] overflow-hidden rounded-lg border will-change-transform",
                        "transition-[opacity,translate] duration-[280ms] ease-(--ease-drawer) starting:translate-x-8 starting:opacity-0",
                        assistantOpen ? "translate-x-0 opacity-100" : "translate-x-8 opacity-0 duration-200",
                        assistantInstant && "duration-0 starting:translate-x-0 starting:opacity-100",
                      )}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[264px] bg-sidebar p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <WorkspaceSidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      {live ? <MobileAssistant /> : null}
      <CommandMenu />
    </CommandMenuProvider>
  );
}

/** On small screens the assistant slides over the page instead of sitting beside it. */
function MobileAssistant() {
  const open = useAssistant((s) => s.open);
  const setOpen = useAssistant((s) => s.setOpen);
  const [small, setSmall] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)");
    const update = () => setSmall(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return (
    <Sheet open={open && small} onOpenChange={setOpen}>
      <SheetContent side="right" className="w-full p-0 sm:max-w-[420px]" showCloseButton={false}>
        <SheetTitle className="sr-only">Ask EveryOps</SheetTitle>
        <AssistantPanel onClose={() => setOpen(false)} className="h-full" />
      </SheetContent>
    </Sheet>
  );
}
