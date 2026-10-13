import Link from "next/link";
import { Reveal } from "./reveal";

export function Closing() {
  return (
    <section className="relative mx-auto w-full max-w-[1120px] px-5 py-24 sm:py-32">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl border border-foreground/10 bg-card/60 px-6 py-16 text-center sm:px-12 sm:py-24">
          <div
            aria-hidden="true"
            className="parallax pointer-events-none absolute -top-40 left-1/2 h-80 w-[640px] -translate-x-1/2 rounded-full bg-primary/25 blur-[100px] [--depth:-0.6]"
          />
          <div aria-hidden="true" className="bg-grid pointer-events-none absolute inset-0 opacity-60" />
          <div className="relative">
            <h2 className="mx-auto max-w-[620px] text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[48px]">
              Describe it once. Run it every day.
            </h2>
            <p className="mx-auto mt-4 max-w-[460px] text-[16px] leading-relaxed text-muted-foreground">
              Free while in preview. Your first system takes about five minutes.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link
                href="/sign-up"
                className="inline-flex h-11 items-center rounded-xl bg-primary px-5 text-[14px] font-medium text-primary-foreground outline-none transition-[background-color,transform] duration-150 hover:bg-glow focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.97]"
              >
                Create your workspace
              </Link>
              <Link
                href="/community"
                className="inline-flex h-11 items-center rounded-xl border px-5 text-[14px] font-medium outline-none transition-[border-color,background-color,transform] duration-150 hover:border-foreground/25 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.97]"
              >
                Browse community systems
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
