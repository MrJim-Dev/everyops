"use client";

import { useEffect, useState } from "react";

const TICK = 16;
/** Characters per tick: short replies type at about two characters a frame, long ones finish in about a second. */
const stepFor = (length: number) => Math.max(2, Math.ceil(length / 70));

/** How long a reply takes to type out, so what comes after it (a plan card, links) can wait for it. */
export function typingMs(text: string) {
  return Math.ceil(text.length / stepFor(text.length)) * TICK;
}

/**
 * A reply typing itself out, a few characters a frame, the way a streamed answer arrives. It stops at a word's end
 * so half-words never flash, and closes an open **bold** so markdown never shows its stars. Only new replies type;
 * with reduced motion the whole text is there at once.
 */
export function useTypewriter(text: string, animate: boolean): string {
  const [count, setCount] = useState(animate ? 0 : text.length);
  useEffect(() => {
    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setCount(text.length);
      return;
    }
    const step = stepFor(text.length);
    let n = 0;
    const id = setInterval(() => {
      n = Math.min(text.length, n + step);
      setCount(n);
      if (n >= text.length) clearInterval(id);
    }, TICK);
    return () => clearInterval(id);
  }, [text, animate]);
  if (count >= text.length) return text;
  let shown = text.slice(0, count);
  const space = shown.search(/\s\S*$/);
  if (space > 0) shown = shown.slice(0, space);
  return (shown.match(/\*\*/g)?.length ?? 0) % 2 ? `${shown}**` : shown;
}
