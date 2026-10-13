import Link from "next/link";
import { SignedIn } from "@/components/auth/auth-guards";
import { CommunityStarters } from "@/components/hub/community-starters";
import { CreatePrompt } from "@/components/hub/create-prompt";
import { RecentWorkspaces } from "@/components/hub/recent-workspaces";

/** Public landing page. Visitors can explore; starting a workspace asks them to sign in first. */
export default function HomePage() {
  return (
    <>
      <section className="flex flex-col items-center gap-6 pb-16 pt-20 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="animate-rise text-balance text-[30px] font-semibold tracking-tight sm:text-[34px]">
            What does your business need?
          </h1>
          <p
            className="animate-rise stagger text-[15px] text-muted-foreground"
            style={{ "--i": 1 } as React.CSSProperties}
          >
            Describe how you work. EveryOps asks the right questions, then builds it in your workspace.
          </p>
        </div>
        <div className="animate-rise stagger w-full" style={{ "--i": 2 } as React.CSSProperties}>
          <CreatePrompt />
        </div>
      </section>
      <div className="flex flex-col gap-14">
        <CommunityStarters />
        <SignedIn>
          <section
            className="animate-rise stagger flex flex-col gap-4"
            style={{ "--i": 7 } as React.CSSProperties}
          >
            <div className="flex items-baseline justify-between gap-4">
              <h2 className="text-[15px] font-semibold">Your workspaces</h2>
              <Link
                href="/workspaces"
                className="rounded-sm text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                View all
              </Link>
            </div>
            <RecentWorkspaces />
          </section>
        </SignedIn>
      </div>
    </>
  );
}
