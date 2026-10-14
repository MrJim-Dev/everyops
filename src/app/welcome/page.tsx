import type { Metadata } from "next";
import { Closing } from "@/components/landing/closing";
import { HeroPrompt } from "@/components/landing/hero-prompt";
import { HowItWorks } from "@/components/landing/how-it-works";
import { LandingFooter } from "@/components/landing/landing-footer";
import { ProductStage } from "@/components/landing/product-stage";
import { Statement } from "@/components/landing/statement";
import { SystemsGallery } from "@/components/landing/systems-gallery";
import { SiteNav } from "@/components/shell/site-nav";

export const metadata: Metadata = {
  title: { absolute: "EveryOps · Describe your business, get the system that runs it" },
};

/** The public front door. Signed-out visitors see it at "/" (src/proxy.ts rewrites to here). */
export default function WelcomePage() {
  return (
    <div id="top" className="min-h-dvh overflow-x-clip bg-shell">
      <SiteNav variant="landing" />
      <main>
        <section className="relative px-5 pt-32 sm:pt-40">
          <div
            aria-hidden="true"
            className="hero-backdrop pointer-events-none absolute inset-x-0 top-0 h-[760px]"
          >
            <div className="bg-grid absolute inset-0" />
            <div className="absolute top-[-220px] left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-primary/[0.14] blur-[120px]" />
          </div>
          <div className="hero-recede relative mx-auto flex max-w-[1000px] flex-col items-center text-center">
            <h1 className="animate-rise text-balance bg-gradient-to-b from-foreground from-40% to-foreground/55 bg-clip-text text-[42px] font-semibold leading-[1.02] tracking-[-0.04em] text-transparent sm:text-[60px] lg:text-[70px]">
              Describe your business. Get the system that runs it.
            </h1>
            <p
              className="animate-rise stagger mt-6 max-w-[560px] text-balance text-[17px] leading-relaxed text-muted-foreground"
              style={{ "--i": 2 } as React.CSSProperties}
            >
              Bookings, sales, stock, leave and content, built from a short conversation and kept in one
              workspace. Change anything by asking.
            </p>
            <div className="animate-rise stagger mt-10 w-full" style={{ "--i": 4 } as React.CSSProperties}>
              <HeroPrompt />
            </div>
          </div>
          <div className="animate-rise stagger relative" style={{ "--i": 6 } as React.CSSProperties}>
            <ProductStage />
          </div>
        </section>
        <Statement />
        <HowItWorks />
        <SystemsGallery />
        <Closing />
      </main>
      <LandingFooter />
    </div>
  );
}
