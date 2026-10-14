"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Reveal } from "./reveal";
import { AnswerVisual, ChangeVisual, DescribeVisual, RunVisual } from "./step-visuals";

const STEPS = [
  {
    title: "Describe how you work",
    body: "Write it the way you'd explain it to a new hire. No templates to pick, no fields to set up.",
    Visual: DescribeVisual,
  },
  {
    title: "Answer a few questions",
    body: "Ask EveryOps asks only what it needs: opening hours, prices, who approves what.",
    Visual: AnswerVisual,
  },
  {
    title: "Run it the same day",
    body: "Your system opens in a workspace with sample data, ready for real bookings, sales or requests.",
    Visual: RunVisual,
  },
  {
    title: "Change it by asking",
    body: "Ask for a new price or field in plain words. You review every change first, and any of them can be undone.",
    Visual: ChangeVisual,
  },
];

/** Steps scroll past on the left while the matching screen stays pinned on the right. */
export function HowItWorks() {
  const [active, setActive] = useState(0);
  // Scenes play only while the section is on screen, so the first one doesn't run out of sight on page load.
  const [inView, setInView] = useState(false);
  const section = useRef<HTMLElement>(null);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      rootMargin: "-30% 0px -30% 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    for (const el of refs.current) if (el) io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section
      ref={section}
      id="how"
      className="mx-auto w-full max-w-[1120px] scroll-mt-20 px-5 py-24 sm:py-32"
    >
      <Reveal className="mb-14 max-w-[560px]">
        <h2 className="text-balance text-[32px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[40px]">
          From a sentence to a system your team uses.
        </h2>
        <p className="mt-4 text-[16px] leading-relaxed text-muted-foreground">
          Each system is a blueprint the assistant writes and a tested engine runs, so it works on day one and
          keeps changing with you.
        </p>
      </Reveal>
      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-20">
        <ol className="relative flex flex-col">
          <span
            aria-hidden="true"
            className="absolute top-2 bottom-2 left-[11px] hidden w-px bg-border lg:block"
          />
          <span
            aria-hidden="true"
            className="absolute top-2 left-[11px] hidden h-[calc(100%-1rem)] w-px origin-top bg-primary transition-transform duration-500 ease-[var(--ease-out-strong)] lg:block"
            style={{ transform: `scaleY(${(active + 1) / STEPS.length})` }}
          />
          {STEPS.map(({ title, body, Visual }, i) => (
            <li key={title} className="lg:flex lg:min-h-[62vh] lg:items-center">
              <div
                ref={(el) => {
                  refs.current[i] = el;
                }}
                data-step={i}
                className="flex flex-col gap-6 pb-14 lg:pb-0"
              >
                <div className="flex gap-5">
                  <span
                    className={cn(
                      "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border bg-shell text-[11px] font-medium tabular transition-colors duration-300",
                      i <= active ? "border-primary text-primary" : "text-muted-foreground",
                    )}
                  >
                    {i + 1}
                  </span>
                  <div
                    className={cn(
                      "transition-opacity duration-300 lg:opacity-50",
                      i === active && "lg:opacity-100",
                    )}
                  >
                    <h3 className="text-[20px] font-semibold tracking-[-0.015em]">{title}</h3>
                    <p className="mt-2 max-w-[420px] text-[15px] leading-relaxed text-muted-foreground">
                      {body}
                    </p>
                  </div>
                </div>
                <div className="h-[380px] lg:hidden">
                  <Visual active={inView && i === active} />
                </div>
              </div>
            </li>
          ))}
        </ol>
        <div className="hidden lg:block">
          <div className="sticky top-[calc(50vh-190px)] h-[380px]">
            {STEPS.map(({ title, Visual }, i) => (
              <div
                key={title}
                aria-hidden={i !== active}
                className={cn(
                  "absolute inset-0 transition-[opacity,transform,filter] duration-500 ease-[var(--ease-out-strong)]",
                  i === active ? "opacity-100" : "pointer-events-none scale-[0.97] opacity-0 blur-[4px]",
                )}
              >
                <Visual active={inView && i === active} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
