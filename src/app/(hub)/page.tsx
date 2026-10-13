import { CommunityStarters } from "@/components/hub/community-starters";
import { CreatePrompt } from "@/components/hub/create-prompt";
import { RecentWorkspaces } from "@/components/hub/recent-workspaces";

export default function HomePage() {
  return (
    <>
      <section className="flex flex-col items-center gap-6 pb-16 pt-20 text-center">
        <div className="flex flex-col gap-2">
          <h1 className="text-balance text-[30px] font-semibold tracking-tight sm:text-[34px]">
            What does your business need?
          </h1>
          <p className="text-[15px] text-muted-foreground">
            Describe how you work. Hulma asks the right questions, then builds it in your workspace.
          </p>
        </div>
        <CreatePrompt />
      </section>
      <div className="flex flex-col gap-14">
        <CommunityStarters />
        <section className="flex flex-col gap-4">
          <h2 className="text-[15px] font-semibold">Your workspaces</h2>
          <RecentWorkspaces />
        </section>
      </div>
    </>
  );
}
