"use client";

import { type RefObject, useEffect } from "react";

/**
 * Keeps a chat pinned to its newest line while the content grows (a reply typing out, a card rising in), as long as
 * the person was already at the bottom. Scrolled up to read, it leaves them where they are.
 */
export function useFollowBottom(scroller: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = scroller.current;
    const content = el?.firstElementChild;
    if (!el || !content) return;
    let pinned = true;
    const onScroll = () => {
      pinned = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    const follow = new ResizeObserver(() => {
      if (pinned) el.scrollTop = el.scrollHeight;
    });
    el.addEventListener("scroll", onScroll, { passive: true });
    follow.observe(content);
    return () => {
      el.removeEventListener("scroll", onScroll);
      follow.disconnect();
    };
  }, [scroller]);
}
