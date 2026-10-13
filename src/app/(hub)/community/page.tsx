import type { Metadata } from "next";
import { CommunityBrowser } from "@/components/community/community-browser";

export const metadata: Metadata = { title: "Community systems" };

export default function CommunityPage() {
  return (
    <div className="flex flex-col gap-8 pt-12">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-[26px] font-semibold tracking-tight">Community systems</h1>
        <p className="text-[14px] text-muted-foreground">
          Open-source systems you can use and make your own.
        </p>
      </div>
      <CommunityBrowser />
    </div>
  );
}
