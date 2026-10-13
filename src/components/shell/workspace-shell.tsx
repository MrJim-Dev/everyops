"use client";

import { ListIcon, SparkleIcon } from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { AssistantPanel } from "@/components/assistant/assistant-panel";
import { RecordPanelsProvider } from "@/components/records/record-panels";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useHotkey } from "@/hooks/use-hotkey";
import { useAssistant } from "@/lib/assistant/panel-store";
import { CommandMenu, CommandMenuProvider } from "./command-menu";
import { WorkspaceSidebar } from "./workspace-sidebar";

/** Linear-style frame: a quiet sidebar on the shell, content in an inset panel, and the assistant on the right. */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);
  const assistantOpen = useAssistant((s) => s.open);
  const setAssistantOpen = useAssistant((s) => s.setOpen);
  const toggleAssistant = useAssistant((s) => s.toggle);
  const live = ws.mode === "live";
  useHotkey(
    "j",
    useCallback(() => toggleAssistant(), [toggleAssistant]),
    live,
  );

  return (
    <CommandMenuProvider>
      <div className="flex h-dvh bg-shell">
        <aside className="hidden w-[232px] shrink-0 md:block">
          <WorkspaceSidebar />
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
            {live ? (
              <Button variant="ghost" size="icon-sm" aria-label="Open assistant" onClick={toggleAssistant}>
                <SparkleIcon />
              </Button>
            ) : null}
          </div>
          <div className="flex min-h-0 flex-1 gap-2">
            <main className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background md:rounded-lg md:border">
              <RecordPanelsProvider>{children}</RecordPanelsProvider>
            </main>
            {live && assistantOpen ? (
              <AssistantPanel
                onClose={() => setAssistantOpen(false)}
                className="hidden w-[380px] shrink-0 animate-rise overflow-hidden rounded-lg border md:flex"
              />
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
        <SheetTitle className="sr-only">Assistant</SheetTitle>
        <AssistantPanel onClose={() => setOpen(false)} className="h-full" />
      </SheetContent>
    </Sheet>
  );
}
