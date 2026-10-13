"use client";

import {
  ArrowRightIcon,
  ClockCounterClockwiseIcon,
  GearSixIcon,
  HouseIcon,
  SparkleIcon,
  SquaresFourIcon,
  UserCircleIcon,
} from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { SystemIcon } from "@/components/system-icon";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useHotkey } from "@/hooks/use-hotkey";
import { useRecentWorkspaces } from "@/lib/store/selectors";
import { WorkspaceTile } from "./workspace-tile";

type CommandMenuState = { open: boolean; setOpen: (open: boolean) => void };
const CommandMenuContext = createContext<CommandMenuState | null>(null);

export function CommandMenuProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  useHotkey("k", toggle);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <CommandMenuContext.Provider value={value}>{children}</CommandMenuContext.Provider>;
}

export function useCommandMenu() {
  const value = useContext(CommandMenuContext);
  if (!value) throw new Error("useCommandMenu must be used inside CommandMenuProvider");
  return value;
}

/**
 * ⌘K. Opened by keyboard many times a day, so it appears instantly with no
 * animation (Emil Kowalski: never animate keyboard-initiated actions).
 */
export function CommandMenu() {
  const { open, setOpen } = useCommandMenu();
  const ws = useWorkspace();
  const router = useRouter();
  const recent = useRecentWorkspaces();

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="top-[22%] translate-y-0 overflow-hidden p-0 sm:max-w-[560px] data-open:animate-none data-closed:animate-none"
      >
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Jump to a system, view or workspace.</DialogDescription>
        <Command className="rounded-none!">
          <CommandInput placeholder="Search systems, views and actions…" />
          <CommandList className="max-h-[360px]">
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Systems">
              {ws.blueprint.systems.map((system) => (
                <CommandItem
                  key={system.id}
                  value={`system ${system.name}`}
                  onSelect={() => go(`${ws.basePath}/${system.id}`)}
                >
                  <SystemIcon name={system.icon} />
                  {system.name}
                </CommandItem>
              ))}
              {ws.blueprint.systems.flatMap((system) =>
                system.viewIds.length > 1
                  ? system.viewIds.map((viewId) => {
                      const view = ws.blueprint.views.find((v) => v.id === viewId);
                      if (!view) return null;
                      return (
                        <CommandItem
                          key={viewId}
                          value={`view ${system.name} ${view.name}`}
                          onSelect={() => go(`${ws.basePath}/${system.id}/${viewId}`)}
                        >
                          <ArrowRightIcon />
                          {system.name}
                          <span className="text-muted-foreground">/ {view.name}</span>
                        </CommandItem>
                      );
                    })
                  : [],
              )}
            </CommandGroup>
            {ws.mode === "live" ? (
              <CommandGroup heading="Actions">
                <CommandItem value="ask hulma change" onSelect={() => go(`${ws.basePath}/ask`)}>
                  <SparkleIcon />
                  Ask Hulma for a change…
                </CommandItem>
                <CommandItem value="history versions undo" onSelect={() => go(`${ws.basePath}/history`)}>
                  <ClockCounterClockwiseIcon />
                  Open history
                </CommandItem>
                <CommandItem
                  value="settings rename export delete workspace"
                  onSelect={() => go(`${ws.basePath}/settings`)}
                >
                  <GearSixIcon />
                  Workspace settings
                </CommandItem>
                <CommandItem value="account profile password" onSelect={() => go("/account")}>
                  <UserCircleIcon />
                  Account settings
                </CommandItem>
              </CommandGroup>
            ) : null}
            <CommandGroup heading="Workspaces">
              {recent.map((item) => (
                <CommandItem
                  key={item.slug}
                  value={`workspace ${item.name}`}
                  onSelect={() => go(`/w/${item.slug}`)}
                >
                  <WorkspaceTile name={item.name} className="size-4 text-[9px]" />
                  {item.name}
                </CommandItem>
              ))}
              <CommandItem value="community systems browse" onSelect={() => go("/community")}>
                <SquaresFourIcon />
                Community systems
              </CommandItem>
              <CommandItem value="home create workspace" onSelect={() => go("/")}>
                <HouseIcon />
                Home
              </CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  );
}
