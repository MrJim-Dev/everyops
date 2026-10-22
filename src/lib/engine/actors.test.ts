import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { actorTypeFor, stampChanged, withActorValues } from "./actors";

const bp = {
  entities: [
    {
      id: "order",
      name: "Order",
      pluralName: "Orders",
      primaryFieldId: "title",
      fields: [
        { id: "title", name: "Title", type: "text" },
        { id: "created_by", name: "Created by", type: "created_by" },
        { id: "edited_by", name: "Last edited by", type: "edited_by" },
      ],
    },
  ],
} as unknown as Blueprint;

const rec = (id: string, title: string, extra: Partial<DataRecord> = {}): DataRecord => ({
  id,
  entityId: "order",
  data: { title },
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...extra,
});

const ana = { type: "person", id: "u1", name: "Ana Cruz" };
const ben = { type: "person", id: "u2", name: "Ben Lim" };

describe("Created by / Last edited by", () => {
  it("fills the fields from the stamps, blank when a record has none", () => {
    const [stamped, old] = withActorValues(bp, [
      rec("a", "One", { createdBy: ana, updatedBy: ben }),
      rec("b", "Two"),
    ]);
    expect(stamped.data).toMatchObject({ created_by: "Ana Cruz", edited_by: "Ben Lim" });
    expect(old.data).toMatchObject({ created_by: "", edited_by: "" });
  });

  it("ignores names typed into the fields: they always follow the stamps", () => {
    const [r] = withActorValues(bp, [
      rec("a", "One", { createdBy: ana, data: { title: "One", created_by: "Me" } }),
    ]);
    expect(r.data.created_by).toBe("Ana Cruz");
  });

  it("stamps a new record with its creator and an edited one with its editor, keeping the creator", () => {
    const before = withActorValues(bp, [
      rec("a", "One", { createdBy: ana, updatedBy: ana }),
      rec("b", "Two"),
    ]);
    const after = [
      { ...before[0], data: { ...before[0].data, title: "One!" } },
      before[1],
      rec("c", "Three"),
    ];
    const [edited, untouched, added] = stampChanged(bp, before, after, ben);
    expect(edited.data).toMatchObject({ created_by: "Ana Cruz", edited_by: "Ben Lim" });
    expect(untouched).toBe(before[1]);
    expect(added.data).toMatchObject({ created_by: "Ben Lim", edited_by: "Ben Lim" });
  });

  it("doesn't count a fresh copy with the same values as an edit", () => {
    const before = withActorValues(bp, [rec("a", "One", { createdBy: ana, updatedBy: ana })]);
    const copy = { ...before[0], data: { ...before[0].data } };
    expect(stampChanged(bp, before, [copy], ben)[0].data.edited_by).toBe("Ana Cruz");
  });

  it("doesn't count a total recalculating as an edit", () => {
    const withTotal = {
      ...bp,
      entities: [
        {
          ...bp.entities[0],
          fields: [...bp.entities[0].fields, { id: "spent", name: "Spent", type: "rollup" }],
        },
      ],
    } as unknown as Blueprint;
    const before = withActorValues(withTotal, [rec("a", "One", { createdBy: ana, updatedBy: ana })]);
    const recalculated = { ...before[0], data: { ...before[0].data, spent: 1200 } };
    expect(stampChanged(withTotal, before, [recalculated], ben)[0]).toBe(recalculated);
  });

  it("reads the field type a text field's name asks for", () => {
    expect(actorTypeFor("Created by")).toBe("created_by");
    expect(actorTypeFor("Submitted  by")).toBe("created_by");
    expect(actorTypeFor("Last edited by")).toBe("edited_by");
    expect(actorTypeFor("Updated by")).toBe("edited_by");
    expect(actorTypeFor("Approved by")).toBeNull();
    expect(actorTypeFor("Created")).toBeNull();
  });
});
