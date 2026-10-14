"use client";

import Link from "next/link";
import { useLayoutEffect, useRef, useState } from "react";
import { lastInputWasKeyboard } from "@/lib/motion/input-modality";
import { cn } from "@/lib/utils";

type Rect = { x: number; w: number };

/** Last underline position per tab group, so it can slide even when the page remounts. */
const lastPosition = new Map<string, Rect>();

export function ViewTabs({
  groupId,
  label,
  items,
  activeId,
  inPlace,
}: {
  groupId: string;
  label: string;
  items: { id: string; href: string; label: string }[];
  activeId?: string;
  /**
   * The tabs switch what this page shows without loading a new route: the URL changes through the History API
   * (Next.js keeps usePathname in step) and the page reads the tab from it. Every tab's data is already here, so a
   * click never waits on the server, and the page isn't kept again as a hidden copy per tab.
   */
  inPlace?: boolean;
}) {
  const refs = useRef(new Map<string, HTMLAnchorElement>());
  const [rect, setRect] = useState<Rect | null>(() => lastPosition.get(groupId) ?? null);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const el = activeId ? refs.current.get(activeId) : undefined;
    if (!el) return;
    const target = { x: el.offsetLeft, w: el.offsetWidth };
    const previous = lastPosition.get(groupId);
    // Already there (e.g. an effect re-run mid-slide): leave any running slide alone.
    if (previous && previous.x === target.x && previous.w === target.w) {
      setRect((r) => r ?? target);
      return;
    }
    // No history, or a keyboard change: snap.
    if (!previous || lastInputWasKeyboard()) {
      lastPosition.set(groupId, target);
      setAnimate(false);
      setRect(target);
      return;
    }
    // Paint the old position first, then slide on the following frame.
    setAnimate(false);
    setRect(previous);
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        lastPosition.set(groupId, target);
        setAnimate(true);
        setRect(target);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [activeId, groupId]);

  return (
    <nav aria-label={label} className="relative flex shrink-0 gap-5 border-b px-5">
      {items.map((item) => {
        const selected = item.id === activeId;
        return (
          <Link
            key={item.id}
            ref={(el) => {
              if (el) refs.current.set(item.id, el);
              else refs.current.delete(item.id);
            }}
            href={item.href}
            prefetch={inPlace ? false : undefined}
            onNavigate={
              inPlace
                ? (event) => {
                    event.preventDefault();
                    if (window.location.pathname !== item.href) window.history.pushState(null, "", item.href);
                  }
                : undefined
            }
            aria-current={selected ? "page" : undefined}
            className={cn(
              "relative py-2.5 text-[13px] outline-none transition-colors duration-150 focus-visible:text-foreground",
              selected ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
      {rect ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute -bottom-px left-0 h-0.5 rounded-full bg-primary",
            animate && "transition-[transform,width] duration-[220ms] ease-(--ease-out-strong)",
          )}
          style={{ transform: `translateX(${rect.x}px)`, width: rect.w }}
        />
      ) : null}
    </nav>
  );
}
