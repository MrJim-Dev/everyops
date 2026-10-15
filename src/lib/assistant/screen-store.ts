"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { MAX_PICKED, type PickedElement, samePick } from "./picked";

/** What a view shows right now, beyond its URL: its search, the dates on screen, the item it has selected. */
export type ViewScreen = {
  viewId: string;
  search?: string;
  from?: string;
  to?: string;
  status?: string;
  selectedId?: string;
};

/** A section of a website picked in the preview, so the assistant knows exactly what "this" means. */
export type BlockRef = {
  viewId: string;
  blockId: string;
  /** What it's called on screen, e.g. Hero or Our courts. */
  label: string;
  /** The block's type, for tailored suggestions. */
  kind: string;
};

type State = {
  /** The record open in the side panel. The assistant can open one too. */
  recordId: string | null;
  view: ViewScreen | null;
  /** The website section the person picked to edit with the assistant. */
  block: BlockRef | null;
  /** Clicking the page picks parts of it for the assistant instead of using them. */
  picking: boolean;
  setPicking: (on: boolean) => void;
  /** Parts of the page picked for the next message, oldest first. */
  picked: PickedElement[];
  addPicked: (element: Omit<PickedElement, "id">) => void;
  removePicked: (id: string) => void;
  clearPicked: () => void;
  openRecord: (id: string | null) => void;
  selectBlock: (block: BlockRef | null) => void;
  report: (view: ViewScreen) => void;
  forget: (viewId: string) => void;
};

/** Shared by the record panel, the views and the assistant, so the assistant knows what's on screen. */
export const useScreen = create<State>()((set) => ({
  recordId: null,
  view: null,
  block: null,
  picking: false,
  setPicking: (picking) => set({ picking }),
  picked: [],
  addPicked: (element) =>
    set((s) => {
      const id = `pick_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const rest = s.picked.filter((p) => !samePick(p, { ...element, id }));
      return { picked: [...rest, { ...element, id }].slice(-MAX_PICKED) };
    }),
  removePicked: (id) => set((s) => ({ picked: s.picked.filter((p) => p.id !== id) })),
  clearPicked: () => set({ picked: [] }),
  openRecord: (recordId) => set({ recordId }),
  selectBlock: (block) => set({ block }),
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
