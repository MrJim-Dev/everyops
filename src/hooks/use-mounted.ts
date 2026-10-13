"use client";

import { useSyncExternalStore } from "react";

const noop = () => () => {};

/** False during server rendering and hydration, true afterwards. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}
