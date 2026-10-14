import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import type { ChangeOp } from "@/lib/engine/changes";
import { applyOps } from "@/lib/engine/changes";
import { embedForms, openUpPublicForms, setAsideBadOps, unanswerable } from "./assistant";

describe("assistant plans", () => {
  it("sets aside an operation that fits no shape instead of failing the whole answer", () => {
    const setAside: string[] = [];
    const json = {
      plan: {
        ops: [
          { op: "rename_workspace", name: "Court House" },
          { op: "add_block", viewId: "home" },
          { op: "make_magic" },
        ],
      },
    };
    setAsideBadOps(json, setAside);
    expect(json.plan.ops).toEqual([{ op: "rename_workspace", name: "Court House" }]);
    expect(setAside).toHaveLength(2);
    expect(setAside[0]).toContain("ops[1] add_block");
    expect(setAside[1]).toContain('"make_magic" isn\'t an operation');
  });

  it("fills a custom page's form placeholder with the public form's real fields", () => {
    const now = new Date("2026-10-13T09:30:00+08:00");
    const { blueprint, records } = courtBookingsSample(now);
    const form = blueprint.views.find((v) => v.type === "form");
    if (form?.type !== "form") throw new Error("no form");
    form.public = true;
    const ops: ChangeOp[] = [
      {
        op: "add_view",
        systemId: blueprint.systems[0].id,
        view: {
          id: "promo",
          entityId: "",
          name: "Promo",
          type: "html",
          html: `<main><h1>Play</h1><div data-everyops-embed="${form.id}"></div></main>`,
        },
      },
    ];
    const errors: string[] = [];
    embedForms(blueprint, records, ops, errors);
    const html = ops[0].op === "add_view" && ops[0].view.type === "html" ? (ops[0].view.html ?? "") : "";
    expect(errors).toEqual([]);
    expect(html).toContain(`data-everyops-form="${form.id}"`);
    expect(html).not.toContain("data-everyops-embed");

    const missing: ChangeOp[] = [
      {
        ...ops[0],
        view: {
          id: "p2",
          entityId: "",
          name: "P2",
          type: "html",
          html: '<div data-everyops-embed="nope"></div>',
        },
      } as ChangeOp,
    ];
    embedForms(blueprint, records, missing, errors);
    expect(errors[0]).toContain('data-everyops-embed="nope" isn\'t a public form');
  });
  it("sends back a public form that requires what visitors can't fill in", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    const bp = structuredClone(blueprint);
    const booking = bp.entities.find((e) => e.id === "booking");
    const player = booking?.fields.find((f) => f.id === "player");
    if (!player) throw new Error("no player");
    player.required = true;
    const view = {
      id: "book",
      entityId: "booking",
      name: "Book",
      type: "form" as const,
      public: true,
      fieldIds: ["court", "slot", "player"],
    };
    bp.views.push(view);
    const ops: ChangeOp[] = [{ op: "add_view", systemId: bp.systems[0].id, view }];
    expect(unanswerable(bp, ops)[0]).toContain("visitors can't fill in player");
    player.required = false;
    expect(unanswerable(bp, ops)).toEqual([]);
  });
  it("opens up a form a custom page embeds, so visitors can actually book", () => {
    const { blueprint, records } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    const bp = structuredClone(blueprint);
    const player = bp.entities.find((e) => e.id === "booking")?.fields.find((f) => f.id === "player");
    if (player) player.required = true;
    const systemId = bp.systems[0].id;
    const ops: ChangeOp[] = [
      {
        op: "add_view",
        systemId,
        view: {
          id: "book_online",
          entityId: "booking",
          name: "Book online",
          type: "form",
          fieldIds: ["court", "slot"],
        },
      },
      {
        op: "add_view",
        systemId,
        view: {
          id: "promo",
          entityId: "",
          name: "Promo",
          type: "html",
          html: '<div data-everyops-embed="book_online"></div>',
        },
      },
    ];
    openUpPublicForms(bp, ops);
    const next = applyOps(bp, ops);
    const form = next.views.find((v) => v.id === "book_online");
    expect(form?.type === "form" && form.public).toBe(true);
    expect(form?.type === "form" && form.fieldIds).toEqual(["court", "slot", "guest_name", "guest_phone"]);
    expect(
      next.entities.find((e) => e.id === "booking")?.fields.find((f) => f.id === "player")?.required,
    ).toBe(false);
    expect(unanswerable(next, ops)).toEqual([]);
    const errors: string[] = [];
    embedForms(next, records, ops, errors);
    expect(errors).toEqual([]);
    expect(validateBlueprint(next)).toEqual([]);
  });
  it("keeps a page whose only tab the plan replaces", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    const page = blueprint.systems.find((s) => s.viewIds.length === 1 && !s.widgetIds.length);
    if (!page) throw new Error("no single-tab page");
    const tab = page.viewIds[0];
    const replaced = applyOps(blueprint, [
      { op: "remove_view", viewId: tab },
      {
        op: "add_view",
        systemId: page.id,
        view: { id: "custom", entityId: "", name: "Custom", type: "html" },
      },
    ]);
    expect(replaced.systems.find((s) => s.id === page.id)?.viewIds).toEqual(["custom"]);
    // Removing it without a replacement still drops the empty page.
    expect(
      applyOps(blueprint, [{ op: "remove_view", viewId: tab }]).systems.some((s) => s.id === page.id),
    ).toBe(false);
  });
  it("asks who is booking on an existing form a custom page embeds, on its own step", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    const bp = structuredClone(blueprint);
    const player = bp.entities.find((e) => e.id === "booking")?.fields.find((f) => f.id === "player");
    if (player) player.required = true;
    const form = bp.views.find((v) => v.type === "form");
    if (form?.type !== "form") throw new Error("no form");
    form.public = true;
    const ops: ChangeOp[] = [
      {
        op: "update_view",
        viewId: form.id,
        patch: {
          fieldIds: ["court", "slot"],
          steps: [
            { id: "when", title: "Court & Time", fieldIds: ["court", "slot"] },
            { id: "pay", title: "Payment", fieldIds: [] },
          ],
        },
      },
      {
        op: "add_view",
        systemId: bp.systems[0].id,
        view: {
          id: "promo",
          entityId: "",
          name: "Promo",
          type: "html",
          html: `<div data-everyops-embed="${form.id}"></div>`,
        },
      },
    ];
    openUpPublicForms(bp, ops);
    const next = applyOps(bp, ops);
    const after = next.views.find((v) => v.id === form.id);
    expect(after?.type === "form" && after.steps?.map((s) => s.title)).toEqual([
      "Court & Time",
      "Your details",
      "Payment",
    ]);
    expect(unanswerable(next, ops)).toEqual([]);
  });
  it("splits a form into steps when the person asked for a multistep form and Gemini left them out", () => {
    const { blueprint } = courtBookingsSample(new Date("2026-10-13T09:30:00+08:00"));
    const ops: ChangeOp[] = [
      {
        op: "add_view",
        systemId: blueprint.systems[0].id,
        view: {
          id: "book_online",
          entityId: "booking",
          name: "Book online",
          type: "form",
          public: true,
          fieldIds: ["court", "slot", "method"],
        },
      },
    ];
    openUpPublicForms(blueprint, ops, [], true);
    const form = applyOps(blueprint, ops).views.find((v) => v.id === "book_online");
    expect(form?.type === "form" && form.steps?.map((s) => s.title)).toEqual([
      "Court and time",
      "Your details",
      "Other details",
    ]);
  });
});
