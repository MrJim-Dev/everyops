import type { WorkspaceData } from "@/lib/blueprint/types";
import { financesSample } from "./business-finances";
import { posSample } from "./canteen-pos";
import { contentSample } from "./content-calendar";
import { courtBookingsSample } from "./court-bookings";
import { leaveSample } from "./employee-leave";

/** Combines two systems into one workspace, e.g. finances plus HR. */
export function combine(name: string, base: WorkspaceData, extra: WorkspaceData): WorkspaceData {
  return {
    blueprint: {
      version: 1,
      workspaceName: name,
      systems: [...base.blueprint.systems, ...extra.blueprint.systems],
      entities: [...base.blueprint.entities, ...extra.blueprint.entities],
      views: [...base.blueprint.views, ...extra.blueprint.views],
      widgets: [...base.blueprint.widgets, ...extra.blueprint.widgets],
      rules: [...base.blueprint.rules, ...extra.blueprint.rules],
    },
    records: [...base.records, ...extra.records],
  };
}

function sunriseBakeshop(now: Date): WorkspaceData {
  const data = combine("Sunrise Bakeshop", financesSample(now), leaveSample(now));
  const overview = data.blueprint.systems.find((s) => s.id === "overview");
  if (overview)
    overview.widgetIds = ["revenue", "expenses", "net", "cashflow", "leave_pending", "budget", "recent"];
  return data;
}

export type DemoWorkspace = {
  slug: string;
  name: string;
  summary: string;
  sourceId?: string;
  build: (now: Date) => WorkspaceData;
};

export const DEMO_WORKSPACES: DemoWorkspace[] = [
  {
    slug: "court-house",
    name: "Court House PH",
    summary: "Bookings and payments",
    sourceId: "court-bookings",
    build: (now) => courtBookingsSample(now, "Court House PH"),
  },
  {
    slug: "tita-nenas-canteen",
    name: "Tita Nena's Canteen",
    summary: "Register and stock",
    sourceId: "canteen-pos",
    build: (now) => posSample(now, "Tita Nena's Canteen"),
  },
  {
    slug: "kape-ilaya",
    name: "Kapé Ilaya",
    summary: "Social media content",
    sourceId: "content-calendar",
    build: (now) => contentSample(now, "Kapé Ilaya"),
  },
  {
    slug: "sunrise-bakeshop",
    name: "Sunrise Bakeshop",
    summary: "Finances and team leave",
    build: sunriseBakeshop,
  },
];
