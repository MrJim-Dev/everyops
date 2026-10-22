import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { setZoneSource, timeZoneOf } from "@/lib/time";

/**
 * The workspace's time zone for the rest of a request or job. Dates the engine reads ("today", schedules, slots,
 * formatting) use it through zone() in src/lib/time.ts. Each request has its own, so two workspaces in different
 * zones handled at once never mix. Without one, Manila.
 */
const current = new AsyncLocalStorage<string>();
setZoneSource(() => current.getStore());

/** Use this workspace's zone from here on in this request (or this pass of a loop over workspaces). */
export function enterZone(bp: { timeZone?: string } | undefined) {
  current.enterWith(timeZoneOf(bp));
}

/** Runs fn on this workspace's clock. */
export function inZone<T>(bp: { timeZone?: string } | undefined, fn: () => T): T {
  return current.run(timeZoneOf(bp), fn);
}
