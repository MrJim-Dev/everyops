import type { Metadata } from "next";
import { WorkspaceSettings } from "@/components/settings/workspace-settings";

// Workspace data lives in this browser for now, so this page renders after it loads.
export const instant = false;

export const metadata: Metadata = { title: "Settings" };

export default function WorkspaceSettingsPage() {
  return <WorkspaceSettings />;
}
