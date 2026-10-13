import type { Metadata } from "next";
import { TeamPage } from "@/components/team/team-page";

// Workspace data lives in this browser for now, so this page renders after it loads.
export const instant = false;

export const metadata: Metadata = { title: "Team" };

export default function Page() {
  return <TeamPage />;
}
