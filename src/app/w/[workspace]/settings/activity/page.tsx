import type { Metadata } from "next";
import { ActivitySettings } from "@/components/settings/activity-settings";

export const instant = false;

export const metadata: Metadata = { title: "Activity" };

export default function Page() {
  return <ActivitySettings />;
}
