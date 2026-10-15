import type { Metadata } from "next";
import { AssistantSettings } from "@/components/settings/assistant-settings";

export const instant = false;

export const metadata: Metadata = { title: "Assistant" };

export default function Page() {
  return <AssistantSettings />;
}
