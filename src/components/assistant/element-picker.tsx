"use client";

import { CursorClickIcon } from "@phosphor-icons/react";
import { type RefObject, useEffect, useRef, useState } from "react";
import { describeElement, pickTarget } from "@/lib/assistant/picked";
import { useScreen } from "@/lib/assistant/screen-store";

/**
 * While Pick from page is on, the workspace page highlights what's under the pointer, and a click picks it for the
 * assistant instead of using it: a short description (what it is, its text, where it sits) goes into the next
 * message. Custom HTML pages pick inside their own frame (see the bridge in html-page.ts).
 * Escape, or the toggle again, stops picking.
 */
export function ElementPicker({ root }: { root: RefObject<HTMLElement | null> }) {
  const picking = useScreen((s) => s.picking);
  const [box, setBox] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    kind: string;
  } | null>(null);
  const hovered = useRef<Element | null>(null);

  useEffect(() => {
    const main = root.current;
    if (!picking || !main) {
      setBox(null);
      return;
    }
    const place = (el: Element | null) => {
      hovered.current = el;
      if (!el) return setBox(null);
      const r = el.getBoundingClientRect();
      const m = main.getBoundingClientRect();
      setBox({
        top: r.top - m.top,
        left: r.left - m.left,
        width: r.width,
        height: r.height,
        kind: describeElement(el, main).kind,
      });
    };
    const targetOf = (e: Event) => {
      const t = e.target;
      return t instanceof Element && main.contains(t) && !t.closest("[data-pick-ignore]")
        ? pickTarget(t, main)
        : null;
    };
    const move = (e: PointerEvent) => place(targetOf(e));
    const swallow = (e: Event) => {
      if (!targetOf(e)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    const click = (e: MouseEvent) => {
      const el = targetOf(e);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      // An iframe picks inside itself; the frame itself never reaches here with its contents.
      if (el instanceof HTMLIFrameElement) return;
      useScreen.getState().addPicked(describeElement(el, main));
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") useScreen.getState().setPicking(false);
    };
    const follow = () => place(hovered.current);
    document.addEventListener("pointermove", move, true);
    for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "submit"])
      document.addEventListener(t, swallow, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
    main.addEventListener("scroll", follow, true);
    window.addEventListener("resize", follow);
    main.style.cursor = "crosshair";
    return () => {
      document.removeEventListener("pointermove", move, true);
      for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup", "dblclick", "submit"])
        document.removeEventListener(t, swallow, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      main.removeEventListener("scroll", follow, true);
      window.removeEventListener("resize", follow);
      main.style.cursor = "";
      hovered.current = null;
    };
  }, [picking, root]);

  if (!picking) return null;
  return (
    <div data-pick-ignore aria-hidden className="pointer-events-none absolute inset-0 z-50">
      {box ? (
        <div
          className="absolute rounded-[5px] border border-primary/80 bg-primary/8 transition-[top,left,width,height] duration-75 ease-out"
          style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
        >
          <span className="absolute -top-5 left-0 rounded-sm bg-primary px-1.5 text-[10.5px] font-medium leading-4 text-primary-foreground">
            {box.kind}
          </span>
        </div>
      ) : null}
      <div className="absolute inset-x-0 bottom-3 flex justify-center">
        <span className="inline-flex items-center gap-1.5 rounded-full border bg-popover/95 px-3 py-1 text-[12px] text-muted-foreground shadow-sm backdrop-blur">
          <CursorClickIcon className="size-3.5 text-primary" />
          Click anything to point Ask EveryOps at it · Esc to stop
        </span>
      </div>
    </div>
  );
}
