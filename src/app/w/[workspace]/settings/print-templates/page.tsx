import type { Metadata } from "next";
import { PrintTemplateSettings } from "@/components/settings/print-template-settings";

export const instant = false;

export const metadata: Metadata = { title: "Print templates" };

export default function Page() {
  return <PrintTemplateSettings />;
}
