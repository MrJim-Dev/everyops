"use client";

import { useEffect } from "react";
import { create } from "zustand";

/** What a view shows right now, beyond its URL: its search, the dates on screen, the item it has selected. */
export type ViewScreen = {
  viewId: string;
  search?: string;
  from?: string;
  to?: string;
  status?: string;
  selectedId?: string;
};

type State = {
  /** The record open in the side panel. The assistant can open one too. */
  recordId: string | null;
  view: ViewScreen | null;
  openRecord: (id: string | null) => void;
  report: (view: ViewScreen) => void;
  forget: (viewId: string) => void;
};

/** Shared by the record panel, the views and the assistant, so the assistant knows what's on screen. */
export const useScreen = create<State>()((set) => ({
  recordId: null,
  view: null,
  openRecord: (recordId) => set({ recordId }),
  report: (view) => set({ view }),
  forget: (viewId) => set((s) => (s.view?.viewId === viewId ? { view: null } : s)),
}));

/** Views call this with their current state; it's cleared when the view goes away. */
export function useReportView(view: ViewScreen) {
  const key = JSON.stringify(view);
  useEffect(() => {
    useScreen.getState().report(JSON.parse(key) as ViewScreen);
  }, [key]);
  const { viewId } = view;
  useEffect(() => () => useScreen.getState().forget(viewId), [viewId]);
}
