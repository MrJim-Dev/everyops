"use client";

import { useEffect, useState } from "react";
import { useWorkspaces } from "./workspaces";

export type FindQuery = {
  entityId: string;
  field?: string;
  equals?: string;
  dateField?: string;
  from?: string;
  to?: string;
  before?: string;
  offset?: number;
  limit?: number;
};

/**
 * Reads records of a windowed type from the server (src/server/find-records.ts) and adds them to this workspace's
 * copy, so calendars, boards and record panels show them like the rest. Returns how many match in all.
 */
export async function loadRecords(slug: string, q: FindQuery): Promise<number | null> {
  const qs = new URLSearchParams(
    Object.entries(q).flatMap(([k, v]) => (v === undefined || v === "" ? [] : [[k, String(v)]])),
  );
  const res = await fetch(`/api/workspaces/${encodeURIComponent(slug)}/records/find?${qs}`, {
    cache: "no-store",
  }).catch(() => null);
  const body = res?.ok
    ? ((await res.json().catch(() => null)) as {
        total: number;
        rows: Parameters<ReturnType<typeof useWorkspaces.getState>["absorb"]>[1];
      } | null)
    : null;
  if (!body) return null;
  useWorkspaces.getState().absorb(slug, body.rows);
  return body.total;
}

/** The most the server returns at once (MAX_FIND in src/server/find-records.ts). */
const PAGE = 1000;

/**
 * Every record a query matches, a page at a time: a busy month or a regular customer's bookings can pass one page.
 * Stops at 50 pages so a runaway query can't keep the browser busy.
 */
export async function loadAll(slug: string, q: Omit<FindQuery, "offset" | "limit">): Promise<number | null> {
  let total: number | null = null;
  for (let offset = 0, page = 0; page < 50; offset += PAGE, page++) {
    const t = await loadRecords(slug, { ...q, offset, limit: PAGE });
    if (t === null) return total;
    total = t;
    if (offset + PAGE >= t) break;
  }
  return total;
}

/** What this copy has of a record type when it's windowed (src/lib/engine/window.ts), else undefined. */
export const useWindowed = (slug: string, entityId: string | undefined) =>
  useWorkspaces((s) => (entityId ? s.workspaces[slug]?.windowed?.[entityId] : undefined));

/**
 * Loads a query's records when it changes and the type is windowed (a calendar month before the window, a record's
 * line items). key decides when to load again; null skips. Returns whether it's loading. Waits a moment so stepping
 * through days or months reads only the one that stays on screen.
 */
export function useLoadRecords(slug: string, key: string | null, q: FindQuery): boolean {
  const [loading, setLoading] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key stands for the query
  useEffect(() => {
    if (!key) return;
    let live = true;
    setLoading(key);
    const timer = setTimeout(() => {
      void loadAll(slug, q).finally(() => {
        if (live) setLoading((k) => (k === key ? null : k));
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [slug, key]);
  return !!key && loading === key;
}
