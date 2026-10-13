"use client";

import { useSyncExternalStore } from "react";

/**
 * Personal view preferences, kept in cookies for this browser (no localStorage in this app).
 * Both are on unless someone turns them off, so only the "off" state is written.
 */
export type ViewPref = "calendarDrag" | "inlineEdit";

const COOKIE: Record<ViewPref, string> = { calendarDrag: "eo_calendar_drag", inlineEdit: "eo_inline_edit" };
const YEAR = 60 * 60 * 24 * 365;
const EVENT = "eo:view-prefs";

const read = (pref: ViewPref) => !document.cookie.split("; ").includes(`${COOKIE[pref]}=off`);
const subscribe = (onChange: () => void) => {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
};

export function useViewPref(pref: ViewPref): boolean {
  return useSyncExternalStore(
    subscribe,
    () => read(pref),
    () => true,
  );
}

export function setViewPref(pref: ViewPref, on: boolean) {
  // biome-ignore lint/suspicious/noDocumentCookie: a plain preference cookie
  document.cookie = on
    ? `${COOKIE[pref]}=; path=/; max-age=0; samesite=lax`
    : `${COOKIE[pref]}=off; path=/; max-age=${YEAR}; samesite=lax`;
  window.dispatchEvent(new Event(EVENT));
}
