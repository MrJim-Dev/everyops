import type { Metadata } from "next";
import { PagesLibrary } from "@/components/pages/pages-library";

// Workspace data lives in this browser for now, so this page renders after it loads (like History).
export const instant = false;

export const metadata: Metadata = { title: "Pages" };

export default function PagesPage() {
  return <PagesLibrary />;
}
