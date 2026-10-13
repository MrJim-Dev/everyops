"use client";

import { createContext, useContext } from "react";
import type { Blueprint, DataRecord, WorkspaceData } from "@/lib/blueprint/types";

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
  blueprint: Blueprint;
  records: DataRecord[];
  data: WorkspaceData;
  /** Saves new records after an engine mutation. */
  commit: (next: WorkspaceData) => void;
};

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export const WorkspaceProvider = WorkspaceContext.Provider;

export function useWorkspace(): WorkspaceApi {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside a workspace");
  return value;
}
