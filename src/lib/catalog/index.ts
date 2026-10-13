import type { IconName, WorkspaceData } from "@/lib/blueprint/types";
import { financesSample } from "./business-finances";
import { posSample } from "./canteen-pos";
import { contentSample } from "./content-calendar";
import { courtBookingsSample } from "./court-bookings";
import { leaveSample } from "./employee-leave";
import { rentalSample } from "./rental-operations";

export type CatalogCategory = "booking" | "finance" | "social" | "hris" | "pos";

export const CATEGORIES: { id: CatalogCategory; label: string }[] = [
  { id: "booking", label: "Booking" },
  { id: "finance", label: "Finance" },
  { id: "social", label: "Social media" },
  { id: "hris", label: "HRIS" },
  { id: "pos", label: "POS" },
];

/**
 * A community system: an open-source blueprint plus sample data for previews.
 * Using one copies the blueprint into the user's workspace; business data
 * never travels with it. Authors and usage counts here are sample catalog data.
 */
export type CatalogSystem = {
  id: string;
  name: string;
  summary: string;
  category: CatalogCategory;
  icon: IconName;
  author: string;
  license: "MIT" | "Apache-2.0";
  version: string;
  uses: number;
  includes: string[];
  /** Set for systems published by someone using EveryOps (not the curated catalog). */
  authorId?: string;
  sample: (now: Date, workspaceName?: string) => WorkspaceData;
};

export const CATALOG: CatalogSystem[] = [
  {
    id: "court-bookings",
    name: "Court bookings",
    summary: "Manage courts, reservations and payments, with double-booking protection.",
    category: "booking",
    icon: "court",
    author: "Mara Villanueva",
    license: "MIT",
    version: "1.2",
    uses: 12400,
    includes: ["Hourly schedule", "Player records", "Payment tracking", "Daily revenue"],
    sample: courtBookingsSample,
  },
  {
    id: "rental-operations",
    name: "Rental operations",
    summary: "Units, stays and guests for short-term rentals, priced per night.",
    category: "booking",
    icon: "key",
    author: "Nico Dizon",
    license: "MIT",
    version: "1.2",
    uses: 9100,
    includes: ["Stay calendar", "Nightly pricing", "Guest records", "Arrivals"],
    sample: rentalSample,
  },
  {
    id: "small-business-finances",
    name: "Small business finances",
    summary: "Income, expenses and a monthly budget that tracks itself.",
    category: "finance",
    icon: "wallet",
    author: "Lea Mercado",
    license: "MIT",
    version: "1.2",
    uses: 8700,
    includes: ["Transaction ledger", "Cash flow chart", "Budget by category"],
    sample: financesSample,
  },
  {
    id: "content-calendar",
    name: "Content calendar",
    summary: "Plan posts from idea to published across Instagram, Facebook and TikTok.",
    category: "social",
    icon: "megaphone",
    author: "Paolo Reyes",
    license: "MIT",
    version: "1.2",
    uses: 6300,
    includes: ["Content board", "Publishing calendar", "Review reminders"],
    sample: contentSample,
  },
  {
    id: "employee-leave",
    name: "Employee leave",
    summary: "Leave requests, approvals and balances that update on approval.",
    category: "hris",
    icon: "airplane",
    author: "Mila Cruz",
    license: "MIT",
    version: "1.2",
    uses: 5800,
    includes: ["Approval queue", "Leave balances", "Team directory"],
    sample: leaveSample,
  },
  {
    id: "canteen-pos",
    name: "Canteen POS",
    summary: "A fast register with stock that updates on every sale.",
    category: "pos",
    icon: "storefront",
    author: "Enzo Lim",
    license: "MIT",
    version: "1.2",
    uses: 4900,
    includes: ["Register", "Order history", "Stock levels", "Daily sales"],
    sample: posSample,
  },
];

export function getCatalogSystem(id: string) {
  return CATALOG.find((s) => s.id === id);
}
