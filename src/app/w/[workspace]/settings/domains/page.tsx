import type { Metadata } from "next";
import { DomainSettings } from "@/components/settings/domain-settings";

export const instant = false;

export const metadata: Metadata = { title: "Domains" };

export default function Page() {
  return <DomainSettings />;
}
