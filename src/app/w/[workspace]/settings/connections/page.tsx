import type { Metadata } from "next";
import { Suspense } from "react";
import { ConnectionSettings } from "@/components/settings/connection-settings";

export const instant = false;

export const metadata: Metadata = { title: "Connections" };

export default function Page() {
  return (
    <Suspense>
      <ConnectionSettings />
    </Suspense>
  );
}
