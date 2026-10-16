import { describe, expect, it } from "vitest";
import { posSample } from "@/lib/catalog/canteen-pos";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { applyPlan, undoPlan } from "@/lib/store/apply-plan";
import { blueprintOf, importedIds, type Workspace, workspaceFrom } from "@/lib/store/workspace-model";
import {
  entityFromTable,
  type ImportOptions,
  parseCsv,
  parseDate,
  parseDateTime,
  parseNumber,
  previewImport,
  sniffType,
  suggestMapping,
} from "./import";

const NOW = new Date("2026-10-16T03:00:00Z");
const ws = (data = posSample(NOW)): Workspace =>
  workspaceFrom({ name: "Shop", summary: "", data }, "shop", NOW.toISOString());
/** What the import dialog has: the current blueprint and the records. */
const dataOf = (w: Workspace) => ({ blueprint: blueprintOf(w), records: w.records });
const opts = (mapping: (string | null)[], more: Partial<ImportOptions> = {}): ImportOptions => ({
  mapping,
  matchFieldId: null,
  onMatch: "update",
  addOptions: false,
  createLinked: false,
  ...more,
});

describe("parseCsv", () => {
  it("reads quoted cells, doubled quotes, line breaks inside quotes and CRLF", () => {
    const t = parseCsv(
      '\uFEFFName,Notes,Price\r\n"Halo-halo, large","Says ""best""\nin town",120\r\nTuron,,35\r\n\r\n',
    );
    expect(t.headers).toEqual(["Name", "Notes", "Price"]);
    expect(t.rows).toEqual([
      ["Halo-halo, large", 'Says "best"\nin town', "120"],
      ["Turon", "", "35"],
    ]);
  });
  it("uses the separator the header uses: semicolons and tabs", () => {
    expect(parseCsv("Name;Price\nTuron;35").rows).toEqual([["Turon", "35"]]);
    expect(parseCsv("Name\tPrice\nTuron\t35").rows).toEqual([["Turon", "35"]]);
  });
});

describe("parsing values", () => {
  it("reads dates the ways spreadsheets write them", () => {
    expect(parseDate("2026-10-16")).toBe("2026-10-16");
    expect(parseDate("10/16/2026")).toBe("2026-10-16");
    expect(parseDate("16/10/2026")).toBe("2026-10-16");
    expect(parseDate("16-Oct-2026")).toBe("2026-10-16");
    expect(parseDate("Oct 16, 2026")).toBe("2026-10-16");
    expect(parseDate("46311")).toBe("2026-10-16");
    expect(parseDate("02/30/2026")).toBeNull();
    expect(parseDate("Court 3")).toBeNull();
  });
  it("reads a Manila date and time", () => {
    expect(parseDateTime("2026-10-16 6:30 PM")).toBe("2026-10-16T10:30:00.000Z");
    expect(parseDateTime("10/16/2026 18:00")).toBe("2026-10-16T10:00:00.000Z");
    expect(parseDateTime("2026-10-16T18:00")).toBe("2026-10-16T10:00:00.000Z");
  });
  it("reads peso amounts", () => {
    expect(parseNumber("₱1,250.50")).toBe(1250.5);
    expect(parseNumber("PHP 300")).toBe(300);
    expect(parseNumber("(300)")).toBe(-300);
    expect(parseNumber("12%")).toBe(12);
    expect(parseNumber("about 300")).toBeNull();
  });
});

describe("suggestMapping", () => {
  it("matches columns to fields by name, plural, and the usual spreadsheet words", () => {
    const product = posSample(NOW).blueprint.entities.find((e) => e.id === "product");
    if (!product) throw new Error("no product");
    expect(
      suggestMapping(product, ["Product name", "Categories", "Unit price", "Qty on hand", "Supplier"]),
    ).toEqual(["name", "category", "price", "stock", null]);
  });
});

describe("previewImport", () => {
  const products = parseCsv(
    [
      "Name,Category,Price,Stock",
      "Calamansi juice,Drinks,45,30",
      "Siopao,Pastries,35,12",
      "Pancit,Meals,,10",
    ].join("\n"),
  );

  it("checks every row and reports what doesn't fit, without changing anything", () => {
    const before = ws();
    const p = previewImport(
      dataOf(before),
      "product",
      products,
      opts(["name", "category", "price", "stock"]),
      NOW,
    );
    expect(p.counts).toEqual({ create: 1, update: 0, skip: 0, error: 2 });
    expect(p.newOptions).toEqual({ category: ["Pastries"] });
    expect(p.rows[1].problems[0]).toContain('"Pastries" isn\'t one of its choices');
    expect(p.rows[2].problems).toEqual(["Price is required"]);
    expect(p.rows[2].row).toBe(4);
    expect(p.plan.recordOps).toHaveLength(1);
    expect(p.plan.source).toBe("import");
  });

  it("adds a new choice when the owner allows it, as a design change in the same plan", () => {
    const p = previewImport(
      dataOf(ws()),
      "product",
      products,
      opts(["name", "category", "price", "stock"], { addOptions: true }),
      NOW,
    );
    expect(p.counts.create).toBe(2);
    const op = p.plan.ops[0];
    expect(op.op).toBe("update_field");
    if (op.op !== "update_field") return;
    expect(op.patch.options?.map((o) => o.label)).toContain("Pastries");
    const { workspace } = applyPlan(ws(), p.plan, { now: NOW });
    const siopao = workspace.records.find((r) => r.data.name === "Siopao");
    expect(siopao?.data.category).toBe("pastries");
  });

  it("fills a required field the sheet doesn't have with one value for every row", () => {
    const sheet = parseCsv("Name,Category,Stock\nPuto,Snacks,12\nKutsinta,Snacks,8");
    const missing = previewImport(dataOf(ws()), "product", sheet, opts(["name", "category", "stock"]), NOW);
    expect(missing.counts.error).toBe(2);
    const filled = previewImport(
      dataOf(ws()),
      "product",
      sheet,
      opts(["name", "category", "stock"], { defaults: { price: "₱15" } }),
      NOW,
    );
    expect(filled.counts.create).toBe(2);
    expect(filled.rows[0].data.price).toBe(15);
  });

  it("updates or skips rows that match an existing record by the chosen field", () => {
    const base = ws();
    const existing = base.records.find((r) => r.entityId === "product");
    if (!existing) throw new Error("no product");
    const sheet = parseCsv(`Name,Price\n${existing.data.name},999\nBrand new,10`);
    const update = previewImport(
      dataOf(base),
      "product",
      sheet,
      opts(["name", "price"], { matchFieldId: "name" }),
      NOW,
    );
    expect(update.counts).toMatchObject({ update: 1 });
    expect(update.plan.recordOps?.[0]).toEqual({
      op: "update_record",
      recordId: existing.id,
      patch: { name: existing.data.name, price: 999 },
    });
    const keep = previewImport(
      dataOf(base),
      "product",
      sheet,
      opts(["name", "price"], { matchFieldId: "name", defaults: { stock: "0" } }),
      NOW,
    );
    // A value for every row doesn't overwrite what an existing record already has.
    expect(keep.plan.recordOps?.[0]).toEqual({
      op: "update_record",
      recordId: existing.id,
      patch: { name: existing.data.name, price: 999 },
    });
    expect(keep.rows[1].data.stock).toBe(0);
    const skip = previewImport(
      dataOf(base),
      "product",
      sheet,
      opts(["name", "price"], { matchFieldId: "name", onMatch: "skip" }),
      NOW,
    );
    expect(skip.counts).toMatchObject({ skip: 1 });
  });

  it("links by name, creates missing linked records when allowed, and catches double bookings within the sheet", () => {
    const courts = ws(courtBookingsSample(NOW));
    const sheet = parseCsv(
      [
        "Player,Court,Time,Payment",
        "Ana Reyes,Court 1,2026-11-02 6:00 PM - 7:00 PM,Paid",
        "Ben Cruz,court 1,2026-11-02 6:30 PM - 7:30 PM,Unpaid",
        "Ben Cruz,Court 2,2026-11-02 6:30 PM - 7:30 PM,Unpaid",
      ].join("\n"),
    );
    const mapping = suggestMapping(
      courts.versions[0].entities.find((e) => e.id === "booking") as never,
      sheet.headers,
    );
    expect(mapping).toEqual(["player", "court", "slot", "status"]);
    const without = previewImport(dataOf(courts), "booking", sheet, opts(mapping), NOW);
    expect(Object.keys(without.missingLinks)).toEqual(["player"]);
    expect(without.counts.error).toBe(3);
    const p = previewImport(dataOf(courts), "booking", sheet, opts(mapping, { createLinked: true }), NOW);
    expect(p.counts).toMatchObject({ create: 2, error: 1 });
    expect(p.rows[1].problems[0]).toMatch(/already booked/);
    const players = p.plan.recordOps?.filter((op) => op.op === "create_record" && op.entityId === "player");
    expect(players).toHaveLength(2);
  });
});

describe("applying an import", () => {
  it("is one History entry, doesn't run save automations, and undoes in one step", () => {
    const base = ws();
    const product = base.records.find((r) => r.entityId === "product");
    const order = base.records.find((r) => r.entityId === "order");
    if (!product || !order) throw new Error("sample");
    const stock = product.data.stock;
    const sheet = parseCsv(`Order,Product,Qty,Price\n${order.data.code},${product.data.name},5,10`);
    const p = previewImport(
      dataOf(base),
      "order_line",
      sheet,
      opts(["order", "product", "qty", "price"]),
      NOW,
    );
    expect(p.counts.create).toBe(1);
    const { workspace, entry } = applyPlan(base, p.plan, { now: NOW });
    expect(entry.source).toBe("import");
    expect(entry.createdRecordIds).toHaveLength(1);
    // The canteen's "deduct stock on sale" automation doesn't take stock for an imported sale line.
    expect(workspace.records.find((r) => r.id === product.id)?.data.stock).toBe(stock);
    const undone = undoPlan(workspace, entry.id, NOW);
    expect(undone?.records.length).toBe(base.records.length);
    // The server leaves the same records out of the save automations it runs.
    expect([...importedIds([entry])]).toEqual(entry.createdRecordIds);
    expect(importedIds([{ ...entry, source: undefined }]).size).toBe(0);
  });

  it("runs the save automations when the owner asks, and the server does too", () => {
    const base = ws();
    const product = base.records.find((r) => r.entityId === "product");
    const order = base.records.find((r) => r.entityId === "order");
    if (!product || !order) throw new Error("sample");
    const sheet = parseCsv(`Order,Product,Qty,Price\n${order.data.code},${product.data.name},5,10`);
    const p = previewImport(
      dataOf(base),
      "order_line",
      sheet,
      opts(["order", "product", "qty", "price"]),
      NOW,
    );
    const { workspace, entry } = applyPlan(base, { ...p.plan, runAutomations: true }, { now: NOW });
    expect(entry.ranAutomations).toBe(true);
    expect(workspace.records.find((r) => r.id === product.id)?.data.stock).toBe(
      Number(product.data.stock) - 5,
    );
    expect(importedIds([entry]).size).toBe(0);
  });

  it("brings in 2,000 rows quickly", () => {
    const lines = ["Name,Category,Price,Stock"];
    for (let i = 0; i < 2000; i++) lines.push(`Item ${i},Snacks,${10 + (i % 90)},${i % 50}`);
    const base = ws();
    const started = performance.now();
    const p = previewImport(
      dataOf(base),
      "product",
      parseCsv(lines.join("\n")),
      opts(["name", "category", "price", "stock"]),
      NOW,
    );
    const { workspace, entry } = applyPlan(base, p.plan, { now: NOW });
    const ms = performance.now() - started;
    expect(p.counts.create).toBe(2000);
    expect(entry.createdRecordIds).toHaveLength(2000);
    expect(workspace.records.length).toBe(base.records.length + 2000);
    expect(ms).toBeLessThan(8000);
  });
});

describe("a new record type from a sheet", () => {
  it("guesses each column's type and makes the name column the record's name", () => {
    const sheet = parseCsv(
      [
        "Member,Email,Mobile,Plan,Joined,Monthly fee,Active",
        "Ana Reyes,ana@mail.ph,0917 555 0101,Gold,2026-01-05,₱1500,Yes",
        "Ben Cruz,ben@mail.ph,0917 555 0102,Silver,2026-02-10,₱900,No",
        "Carla Lim,carla@mail.ph,0917 555 0103,Gold,2026-03-15,₱1500,Yes",
        "Dan Uy,dan@mail.ph,0917 555 0104,Silver,2026-04-01,₱900,Yes",
      ].join("\n"),
    );
    const { entity, mapping } = entityFromTable("Members", sheet, new Set());
    expect(entity).toMatchObject({
      id: "member",
      name: "Member",
      pluralName: "Members",
      primaryFieldId: "member",
    });
    expect(entity.fields.map((f) => f.type)).toEqual([
      "text",
      "email",
      "phone",
      "select",
      "date",
      "money",
      "checkbox",
    ]);
    expect(mapping).toEqual(entity.fields.map((f) => f.id));
    expect(sniffType("Notes", ["a".repeat(200)]).type).toBe("long_text");
  });
});
