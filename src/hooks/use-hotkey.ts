"use client";

import { useEffect } from "react";

/** Runs a handler for ⌘/Ctrl + key. Ignores the shortcut while composing text or inside the markdown editor. */
export function useHotkey(key: string, handler: (event: KeyboardEvent) => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      // Inside the markdown editor its own shortcuts win (⌘K adds a link there).
      if (event.target instanceof Element && event.target.closest(".mdxeditor")) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === key.toLowerCase()) {
        event.preventDefault();
        handler(event);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, handler, enabled]);
}
