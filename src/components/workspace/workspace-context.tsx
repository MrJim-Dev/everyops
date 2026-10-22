"use client";

import { createContext, type ReactNode, useContext } from "react";
import type { Blueprint, DataRecord, WorkspaceData } from "@/lib/blueprint/types";
import type { PageDoc } from "@/lib/store/workspace-model";
import type { Role } from "@/lib/store/workspaces";
import { setBrowserZone } from "@/lib/time";
import { CurrencyProvider } from "./currency";

/**
 * Everything a view needs to render and edit a workspace. Saved workspaces
 * and community previews provide the same shape, so every system screen is
 * written once.
 */
export type WorkspaceApi = {
  mode: "live" | "preview";
  /** Workspace slug, or the community system id for previews. */
  id: string;
  /** Where system routes live, e.g. "/w/court-house" or "/preview/court-bookings". */
  basePath: string;
  name: string;
  /** The signed-in person's role here. Previews behave as owner (nothing is saved). */
  role: Role;
  /** True when someone else owns this workspace and shared it. */
  isShared: boolean;
  blueprint: Blueprint;
  records: DataRecord[];
  data: WorkspaceData;
  /** Saves new records after an engine mutation. */
  commit: (next: WorkspaceData) => void;
  /** Markdown of document pages, by view id. */
  docs: Record<string, PageDoc>;
  saveDoc: (viewId: string, body: string) => void;
};

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

/**
 * A workspace for the screens below it, with its currency for the money they show. Its clock (time zone) is set for
 * the browser as it renders, so every date, "today" and schedule on screen reads in the workspace's zone. A browser
 * tab shows one workspace at a time.
 */
export function WorkspaceProvider({ value, children }: { value: WorkspaceApi; children: ReactNode }) {
  setBrowserZone(value.blueprint.timeZone);
  return (
    <WorkspaceContext.Provider value={value}>
      <CurrencyProvider currency={value.blueprint.currency}>{children}</CurrencyProvider>
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceApi {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside a workspace");
  return value;
}
