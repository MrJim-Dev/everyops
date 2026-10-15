"use client";

import { create } from "zustand";
import type { DesignSketch, DesignStage } from "@/lib/assistant/design-sketch";

/** A design in progress: the step, the sketch of what Gemini has written so far, and when it started. */
export type DesignBuild = {
  stage: DesignStage;
  issues?: number;
  sketch?: DesignSketch;
  since: number;
  /** The design is finished: the screen holds for a moment on the finished workspace before the review. */
  ready?: boolean;
};

type Update = DesignBuild | null | ((build: DesignBuild | null) => DesignBuild | null);

/**
 * The workspaces being set up, shared with the shell: while Gemini designs one, its sidebar fills in with the pages
 * and its switcher takes the name, on whatever page the owner is on; afterwards the draft shows until it's created.
 * Kept per workspace, so opening another one never interrupts a build.
 */
export const useSetupBuild = create<{
  builds: Record<string, DesignBuild>;
  /** Finished designs waiting for Create workspace. */
  drafts: Record<string, DesignSketch>;
  setBuild: (workspaceId: string, next: Update) => void;
  setDraft: (workspaceId: string, draft: DesignSketch | null) => void;
  clear: (workspaceId: string) => void;
}>((set) => ({
  builds: {},
  drafts: {},
  setBuild: (workspaceId, next) =>
    set((s) => {
      const build = typeof next === "function" ? next(s.builds[workspaceId] ?? null) : next;
      const builds = { ...s.builds };
      if (build) builds[workspaceId] = build;
      else delete builds[workspaceId];
      return { builds };
    }),
  setDraft: (workspaceId, draft) =>
    set((s) => {
      const drafts = { ...s.drafts };
      if (draft) drafts[workspaceId] = draft;
      else delete drafts[workspaceId];
      return { drafts };
    }),
  clear: (workspaceId) =>
    set((s) => {
      const builds = { ...s.builds };
      const drafts = { ...s.drafts };
      delete builds[workspaceId];
      delete drafts[workspaceId];
      return { builds, drafts };
    }),
}));

/** The design being built for this workspace, if any. */
export const useBuildOf = (workspaceId: string) => useSetupBuild((s) => s.builds[workspaceId] ?? null);

/** What the shell shows of the setup: the sketch being built, else the finished draft. */
export const useSetupSketch = (workspaceId: string) =>
  useSetupBuild((s) => {
    const build = s.builds[workspaceId];
    return build ? (build.sketch ?? null) : (s.drafts[workspaceId] ?? null);
  });
