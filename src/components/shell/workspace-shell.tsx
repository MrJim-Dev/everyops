"use client";

import { ListIcon } from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import { RecordPanelsProvider } from "@/components/records/record-panels";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { CommandMenu, CommandMenuProvider } from "./command-menu";
import { WorkspaceSidebar } from "./workspace-sidebar";

/** Linear-style frame: a quiet sidebar on the shell, content in an inset panel. */
export function WorkspaceShell({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const [mobileOpen, setMobileOpen] = useState(false);

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
            <span className="truncate text-[13px] font-medium">{ws.name}</span>
          </div>
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background md:rounded-lg md:border">
            <RecordPanelsProvider>{children}</RecordPanelsProvider>
          </main>
        </div>
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-[264px] bg-sidebar p-0" showCloseButton={false}>
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <WorkspaceSidebar onNavigate={() => setMobileOpen(false)} />
        </SheetContent>
      </Sheet>
      <CommandMenu />
    </CommandMenuProvider>
  );
}
