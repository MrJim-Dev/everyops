import type { Metadata } from "next";
import { WebhookSettings } from "@/components/settings/webhook-settings";

export const instant = false;

export const metadata: Metadata = { title: "Webhooks" };

export default function Page() {
  return <WebhookSettings />;
}
