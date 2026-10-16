"use client";

import { CaretUpDownIcon, CheckIcon, PlusIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useNewWorkspace } from "@/components/hub/create-prompt";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { useRecentWorkspaces } from "@/lib/store/selectors";
import { useSetupSketch } from "@/lib/store/setup-build";
import { WorkspaceTile } from "./workspace-tile";

export function WorkspaceSwitcher() {
  const ws = useWorkspace();
  const router = useRouter();
  const newWorkspace = useNewWorkspace();
  const recent = useRecentWorkspaces();
  // While a workspace is set up, it takes the name Gemini gives it as soon as that's written.
  const setupName = useSetupSketch(ws.id)?.name;
  const name = (!ws.blueprint.systems.length && setupName) || ws.name;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-sidebar-accent">
        <span key={name} className="flex min-w-0 flex-1 animate-swap items-center gap-2">
          <WorkspaceTile name={name} />
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{name}</span>
        </span>
        <CaretUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
          {recent.map((item) => (
            <DropdownMenuItem key={item.slug} onClick={() => router.push(`/w/${item.slug}`)}>
              <WorkspaceTile name={item.name} />
              <span className="flex-1 truncate">{item.name}</span>
              {ws.mode === "live" && item.slug === ws.id ? <CheckIcon className="text-primary" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={newWorkspace}>
            <PlusIcon />
            Create a workspace
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => router.push("/community")}>
            <SquaresFourIcon />
            Community systems
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
