"use client";

import { LayoutView } from "@/components/layout-page/layout-view";
import type { View } from "@/lib/blueprint/types";
import { ApprovalQueueView } from "./approval-queue-view";
import { CalendarView } from "./calendar-view";
import { CanvasView } from "./canvas-view";
import { CheckoutView } from "./checkout-view";
import { DocumentView } from "./document-view";
import { FormView } from "./form-view";
import { HtmlPageView } from "./html-page-view";
import { KanbanView } from "./kanban-view";
import { LandingView } from "./landing-view";
import { NotesView } from "./notes-view";
import { SlotGridView } from "./slot-grid-view";
import { TableView } from "./table-view";

/** Maps a view in the blueprint to the one component that renders that view type. */
export function ViewRenderer({ view }: { view: View }) {
  switch (view.type) {
    case "table":
      return <TableView key={view.id} view={view} />;
    case "kanban":
      return <KanbanView key={view.id} view={view} />;
    case "calendar":
      return <CalendarView key={view.id} view={view} />;
    case "slot_grid":
      return <SlotGridView key={view.id} view={view} />;
    case "checkout":
      return <CheckoutView key={view.id} view={view} />;
    case "approval_queue":
      return <ApprovalQueueView key={view.id} view={view} />;
    case "form":
      return <FormView key={view.id} view={view} />;
    case "notes":
      return <NotesView key={view.id} view={view} />;
    case "document":
      return <DocumentView key={view.id} view={view} />;
    case "canvas":
      return <CanvasView key={view.id} view={view} />;
    case "landing":
      return <LandingView key={view.id} view={view} />;
    case "html":
      return <HtmlPageView key={view.id} view={view} />;
    case "layout":
      return <LayoutView key={view.id} view={view} />;
  }
}

/**
 * Views where "New …" makes sense from the page header. An approval queue counts: it's often the only screen for
 * what it reviews, and a furniture ERP's customer payments could be verified there but never recorded.
 */
export const CREATABLE: View["type"][] = ["table", "kanban", "calendar", "slot_grid", "approval_queue"];
