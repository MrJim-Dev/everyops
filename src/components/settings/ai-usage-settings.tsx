"use client";

import { useWorkspace } from "@/components/workspace/workspace-context";
import { canManage } from "@/lib/store/workspace-model";
import { AiUsageCard } from "./ai-usage-card";
import { AiUsageReport } from "./ai-usage-report";
import { SettingsPage, SettingsSection } from "./settings-section";

/** Settings → AI use: this month against the budget, then where the workspace's AI use came from. */
export function AiUsageSettings() {
  const ws = useWorkspace();
  if (ws.mode !== "live")
    return (
      <SettingsPage>
        <SettingsSection
          title="AI use"
          description="AI use is tracked for workspaces saved to your account. Open this workspace from your account to see it."
        />
      </SettingsPage>
    );
  return (
    <SettingsPage>
      <AiUsageCard workspaceId={ws.id} />
      <SettingsSection
        title="Where it came from"
        description={
          canManage(ws.role)
            ? "Every Gemini call made for this workspace, by feature, step, person, model and where it ran. Duplicates that lost the race, stopped loops and failures count as wasted: they were paid for but their answer was thrown away."
            : "Every Gemini call made for this workspace, by feature, step, model and where it ran. The latest calls show your own; owners and admins see everyone's."
        }
        footer="Costs are estimates at Vertex AI's rates for each model; Google's invoice is the bill."
      >
        <AiUsageReport endpoint={`/api/workspaces/${encodeURIComponent(ws.id)}/ai-usage`} view="workspace" />
      </SettingsSection>
    </SettingsPage>
  );
}
