import { describe, expect, it } from "vitest";
import { posSample } from "@/lib/catalog/canteen-pos";
import { dataDigest } from "./digest";

describe("the assistant's data digest", () => {
  it("summarises every record type in far less text than the records, with exact totals", () => {
    const { blueprint, records } = posSample(new Date("2026-10-13T00:00:00Z"), "Kape");
    const digest = dataDigest(blueprint, records, { ids: [] });
    for (const e of blueprint.entities) {
      const n = records.filter((r) => r.entityId === e.id).length;
      expect(digest).toContain(`(${e.id}): ${n} records`);
    }
    const money = blueprint.entities.flatMap((e) =>
      e.fields.filter((f) => f.type === "money").map((f) => ({ e, f })),
    );
    const { e, f } = money[0];
    const sum = records
      .filter((r) => r.entityId === e.id)
      .reduce((n, r) => n + (typeof r.data[f.id] === "number" ? (r.data[f.id] as number) : 0), 0);
    expect(digest).toContain(
      `- ${f.id} (money): sum ${sum.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    );
  });

  it("lists records on screen in full", () => {
    const { blueprint, records } = posSample(new Date("2026-10-13T00:00:00Z"), "Kape");
    const target = records.at(-1);
    expect(dataDigest(blueprint, records, { ids: target ? [target.id] : [] })).toContain(
      `"id":"${target?.id}"`,
    );
  });
});
