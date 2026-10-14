"use client";

import { useEffect, useState } from "react";

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Plays a short scene while its step is the active one and returns how far it has got (0 to `beats.length`).
 * `beats` are the pauses in ms before each next moment; keep the array at module level. It never steps back while
 * active, resets once the panel has faded out (so it plays again next time), and with reduced motion it shows the
 * finished scene at once.
 */
export function useScene(active: boolean, beats: readonly number[]) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (!active) {
      const reset = setTimeout(() => setStage(0), 600);
      return () => clearTimeout(reset);
    }
    if (reducedMotion()) {
      setStage(beats.length);
      return;
    }
    let at = 0;
    const timers = beats.map((pause, i) => {
      at += pause;
      return setTimeout(() => setStage((s) => Math.max(s, i + 1)), at);
    });
    return () => {
      for (const t of timers) clearTimeout(t);
    };
  }, [active, beats]);
  return stage;
}

/** How many characters of a line have been typed, starting `delay` ms after the step becomes active. */
export function useTyped(active: boolean, length: number, { delay = 250, every = 24 } = {}) {
  const [typed, setTyped] = useState(0);
  useEffect(() => {
    if (!active) {
      const reset = setTimeout(() => setTyped(0), 600);
      return () => clearTimeout(reset);
    }
    if (reducedMotion()) {
      setTyped(length);
      return;
    }
    let tick: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      tick = setInterval(() => {
        setTyped((n) => {
          if (n + 1 >= length) clearInterval(tick);
          return Math.min(length, n + 1);
        });
      }, every);
    }, delay);
    return () => {
      clearTimeout(start);
      clearInterval(tick);
    };
  }, [active, length, delay, every]);
  return typed;
}
