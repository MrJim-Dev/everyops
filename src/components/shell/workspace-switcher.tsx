"use client";

import { CaretUpDownIcon, CheckIcon, PlusIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
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
import { WorkspaceTile } from "./workspace-tile";

export function WorkspaceSwitcher() {
  const ws = useWorkspace();
  const router = useRouter();
  const recent = useRecentWorkspaces();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 data-popup-open:bg-sidebar-accent">
        <WorkspaceTile name={ws.name} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{ws.name}</span>
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
          <DropdownMenuItem onClick={() => router.push("/")}>
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
