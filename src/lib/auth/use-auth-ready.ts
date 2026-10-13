"use client";

import { useSyncExternalStore } from "react";
import { useAuth } from "./store";

const subscribe = (callback: () => void) => useAuth.persist.onFinishHydration(callback);

/** True once the saved session has been read from this browser. */
export function useAuthReady(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => useAuth.persist.hasHydrated(),
    () => false,
  );
}
