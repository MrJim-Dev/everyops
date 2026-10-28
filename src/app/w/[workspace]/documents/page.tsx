import type { Metadata } from "next";
import { Suspense } from "react";
import { DocumentsLibrary } from "@/components/documents/documents-library";

// Workspace data lives in this browser for now, so this page renders after it loads (like History).
export const instant = false;

export const metadata: Metadata = { title: "Documents" };

export default function DocumentsPage() {
  return (
    <Suspense>
      <DocumentsLibrary />
    </Suspense>
  );
}
