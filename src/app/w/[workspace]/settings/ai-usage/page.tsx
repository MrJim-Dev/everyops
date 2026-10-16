import type { Metadata } from "next";
import { AiUsageSettings } from "@/components/settings/ai-usage-settings";

export const instant = false;

export const metadata: Metadata = { title: "AI use" };

export default function Page() {
  return <AiUsageSettings />;
}
