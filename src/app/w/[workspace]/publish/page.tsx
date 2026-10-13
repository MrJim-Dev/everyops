import type { Metadata } from "next";
import { PublishPage } from "@/components/publish/publish-page";

// Workspace data lives in this browser for now, so this page renders after it loads.
export const instant = false;

export const metadata: Metadata = { title: "Publish to Community" };

export default function Page() {
  return <PublishPage />;
}
