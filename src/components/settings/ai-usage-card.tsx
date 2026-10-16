"use client";

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SettingsSection } from "./settings-section";

type Usage = { month: string; tokens: number; requests: number; budget: number; lastMonth: number };
type Mine = { used: number; max: number };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** What Ask EveryOps used this month in this workspace, against the monthly budget when there is one. */
export function AiUsageCard({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<{ usage: Usage; mine: Mine } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/ai-usage`)
      .then((r) => r.json())
      .then((body: { ok: boolean; usage?: Usage; mine?: Mine }) => {
        if (live && body.ok && body.usage && body.mine) setData({ usage: body.usage, mine: body.mine });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [workspaceId]);

  const usage = data?.usage;
  const share = usage?.budget ? Math.min(100, (usage.tokens / usage.budget) * 100) : 0;
  const month = usage ? MONTHS[Number(usage.month.slice(5, 7)) - 1] : "";

  return (
    <SettingsSection
      title="AI use"
      description="Gemini tokens (what Ask EveryOps reads and writes) and requests in this workspace. Setup before a workspace exists counts to your account."
      footer={
        data
          ? `Your requests: ${data.mine.used} of ${data.mine.max} in the last 10 minutes. The limit frees up as they age.`
          : undefined
      }
    >
      {!usage ? (
        <Skeleton className="h-16" />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="flex flex-col">
              <span className="text-[12px] text-muted-foreground">{month} so far</span>
              <span className="font-mono text-[20px] tabular-nums">{formatNumber(usage.tokens)}</span>
              <span className="text-[12px] text-muted-foreground">tokens</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[12px] text-muted-foreground">Requests</span>
              <span className="font-mono text-[20px] tabular-nums">{formatNumber(usage.requests)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[12px] text-muted-foreground">Last month</span>
              <span className="font-mono text-[20px] tabular-nums text-muted-foreground">
                {formatNumber(usage.lastMonth)}
              </span>
            </div>
          </div>
          {usage.budget ? (
            <div className="flex flex-col gap-1.5">
              <Progress value={share} aria-label="Share of the monthly AI budget used" />
              <span className={cn("text-[12.5px]", share >= 90 ? "text-warning" : "text-muted-foreground")}>
                {Math.round(share)}% of the {formatNumber(usage.budget)}-token monthly budget.{" "}
                {share >= 100 ? "Ask EveryOps is paused until the 1st." : "It renews on the 1st."}
              </span>
            </div>
          ) : (
            <span className="text-[12.5px] text-muted-foreground">
              No monthly budget is set for this workspace.
            </span>
          )}
        </div>
      )}
    </SettingsSection>
  );
}
