import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord, Entity } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { f } from "@/lib/catalog/define";
import { aboutPeople, personalField } from "@/lib/components/public-safety";
import { publicFieldsOf } from "@/lib/public/resolve";
import { computeAll } from "./compute";
import { createRecord } from "./records";

const NOW = new Date("2026-10-15T02:00:00Z");
const client: Entity = {
  id: "clients",
  name: "Client",
  pluralName: "Clients",
  primaryFieldId: "name",
  fields: [
    f.text("name", "Name", { required: true }),
    f.email("email", "Email"),
    f.phone("phone", "Phone"),
    f.url("website", "Website"),
    f.file("contract", "Contract"),
    f.rollup("paid_total", "Paid", {
      childEntityId: "payments",
      viaFieldId: "client",
      op: "sum",
      fieldId: "amount",
      filter: 'status == "paid"',
    }),
  ],
};
const payment: Entity = {
  id: "payments",
  name: "Payment",
  pluralName: "Payments",
  primaryFieldId: "ref",
  fields: [
    f.text("ref", "Ref"),
    f.relation("client", "Client", "clients"),
    f.money("amount", "Amount"),
    f.status("status", "Status", [
      ["paid", "Paid"],
      ["pending", "Pending"],
    ]),
  ],
};
const bp: Blueprint = {
  version: 1,
  workspaceName: "Studio",
  systems: [],
  entities: [client, payment],
  views: [{ id: "intake", entityId: "clients", name: "Intake", type: "form", fieldIds: [], public: true }],
  widgets: [],
  rules: [],
};
const rec = (id: string, entityId: string, data: DataRecord["data"]): DataRecord => ({
  id,
  entityId,
  data,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});

describe("email, phone, link and file fields", () => {
  it("refuse values that aren't what they say", () => {
    const res = createRecord(
      { blueprint: bp, records: [] },
      "clients",
      { name: "Ana", email: "ana@", phone: "123", website: "not a link", contract: "https://x.test/a.pdf" },
      NOW,
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.map((e) => e.fieldId)).toEqual(["email", "phone", "website", "contract"]);
    const good = createRecord(
      { blueprint: bp, records: [] },
      "clients",
      {
        name: "Ana",
        email: "ana@studio.ph",
        phone: "0917 555 0123",
        website: "studio.ph",
        contract: "/api/files/studio/docs/0b6f3c55-8f0e-4c55-9f53-7c2d5c3a1e10.pdf?name=Contract.pdf",
      },
      NOW,
    );
    expect(good.ok).toBe(true);
  });

  it("count as personal data on public pages, and files stay off public forms", () => {
    expect(personalField(bp, client.fields[1])).toBe(true);
    expect(personalField(bp, { ...client.fields[1], name: "Inbox", id: "inbox" })).toBe(true);
    expect(personalField(bp, client.fields[3])).toBe(false);
    expect(personalField(bp, client.fields[4])).toBe(true);
    expect(aboutPeople({ ...client, id: "studios", name: "Studio", pluralName: "Studios" })).toBe(true);
    const view = bp.views[0];
    if (view.type !== "form") throw new Error("form");
    expect(publicFieldsOf(bp, view).map((x) => x.id)).toEqual(["name", "email", "phone", "website"]);
  });
});

describe("filtered rollups", () => {
  it("add up only the children the filter keeps", () => {
    const records = computeAll(
      bp,
      [
        rec("c1", "clients", { name: "Ana" }),
        rec("p1", "payments", { ref: "1", client: "c1", amount: 500, status: "paid" }),
        rec("p2", "payments", { ref: "2", client: "c1", amount: 300, status: "pending" }),
        rec("p3", "payments", { ref: "3", client: "c1", amount: 200, status: "paid" }),
      ],
      NOW,
    );
    expect(records.find((r) => r.id === "c1")?.data.paid_total).toBe(700);
  });

  it("are checked against the child's fields", () => {
    const broken = structuredClone(bp);
    const rollup = broken.entities[0].fields[5];
    if (rollup.rollup) rollup.rollup.filter = 'state == "paid"';
    expect(
      validateBlueprint(broken)
        .map((e) => e.message)
        .join(" "),
    ).toContain('"state" is not a field on Payment');
    expect(validateBlueprint(bp)).toEqual([]);
  });
});
