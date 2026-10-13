import type { Metadata } from "next";
import { AskRoute } from "@/components/routes/workspace-routes";

// Workspace data lives in this browser for now, so these pages render after it loads.
// They can't be prerendered for instant navigation until the data moves to the server.
export const instant = false;

export const metadata: Metadata = { title: "Ask Hulma" };

export default function AskPage() {
  return <AskRoute />;
}
