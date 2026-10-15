import type { Metadata } from "next";
import { AutomationSettings } from "@/components/settings/automation-settings";

export const instant = false;

export const metadata: Metadata = { title: "Automations" };

export default function Page() {
  return <AutomationSettings />;
}
