"use client";

import { createContext, type ReactNode, useContext, useSyncExternalStore } from "react";
import { create } from "zustand";
import { SIDEBAR_COOKIE } from "./sidebar-cookie";

const YEAR = 60 * 60 * 24 * 365;

type State = {
  /** Set once the person toggles in this tab; until then the cookie (or screen size) decides. */
  collapsed: boolean | null;
  /** True for one toggle that came from the keyboard, which skips the animation. */
  instant: boolean;
  toggle: (current: boolean, instant?: boolean) => void;
};

export const useSidebar = create<State>()((set) => ({
  collapsed: null,
  instant: false,
  toggle: (current, instant = false) => {
    const collapsed = !current;
    set({ collapsed, instant });
    // biome-ignore lint/suspicious/noDocumentCookie: a plain preference cookie, read back on the server
    document.cookie = `${SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; path=/; max-age=${YEAR}; samesite=lax`;
    // Re-enable the transition once the instant change has painted.
    if (instant) requestAnimationFrame(() => requestAnimationFrame(() => set({ instant: false })));
  },
}));

const SavedPreference = createContext<boolean | null>(null);

/**
 * Sidebar page groups someone opened or closed, by workspace and group name, for this tab only. Groups nobody has
 * touched follow the default (see WorkspaceSidebar).
 */
export const usePageGroups = create<{
  open: Record<string, boolean>;
  setOpen: (key: string, open: boolean) => void;
}>()((set) => ({
  open: {},
  setOpen: (key, open) => set((s) => ({ open: { ...s.open, [key]: open } })),
}));

/** Seeds the sidebar with the preference the server read from the cookie. */
export function SidebarPreferenceProvider({
  collapsed,
  children,
}: {
  collapsed: boolean | null;
  children: ReactNode;
}) {
  return <SavedPreference value={collapsed}>{children}</SavedPreference>;
}

const query = "(min-width: 1024px)";
const subscribe = (onChange: () => void) => {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
};

/**
 * Whether the sidebar shows as a rail: this tab's last toggle, else the saved cookie, else the screen
 * size (a rail on tablet widths, full on desktop).
 */
export function useSidebarCollapsed(): boolean {
  const collapsed = useSidebar((s) => s.collapsed);
  const saved = useContext(SavedPreference);
  const wide = useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => true,
  );
  return collapsed ?? saved ?? !wide;
}
