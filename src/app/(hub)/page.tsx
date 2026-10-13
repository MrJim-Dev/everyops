import { CommunityStarters } from "@/components/hub/community-starters";
import { CreatePrompt } from "@/components/hub/create-prompt";
import { HubGreeting } from "@/components/hub/hub-greeting";

/**
 * Home for signed-in people: the prompt and community systems. Their workspaces live at /workspaces.
 * Signed-out visitors get the landing page here instead (src/proxy.ts rewrites "/" to /welcome);
 * the page stays public, so a stale cookie still lands somewhere useful, and the prompt asks to sign in.
 */
export default function HomePage() {
  return (
    <>
      <section className="relative flex flex-col items-center gap-8 pb-20 pt-20 text-center sm:pt-24">
        <div
          aria-hidden="true"
          className="bg-grid pointer-events-none absolute inset-x-[-20vw] top-0 h-[520px]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-[-200px] left-1/2 h-[420px] w-[760px] -translate-x-1/2 rounded-full bg-primary/[0.12] blur-[110px]"
        />
        <div className="relative flex flex-col items-center gap-3">
          <div className="animate-rise">
            <HubGreeting />
          </div>
          <h1
            className="animate-rise stagger text-balance text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[44px]"
            style={{ "--i": 1 } as React.CSSProperties}
          >
            What does your business need?
          </h1>
          <p
            className="animate-rise stagger max-w-[520px] text-balance text-[15.5px] leading-relaxed text-muted-foreground"
            style={{ "--i": 2 } as React.CSSProperties}
          >
            Describe how you work. EveryOps asks the right questions, then builds it in your workspace.
          </p>
        </div>
        <div className="animate-rise stagger relative w-full" style={{ "--i": 3 } as React.CSSProperties}>
          <CreatePrompt />
        </div>
      </section>
      <CommunityStarters />
    </>
  );
}
