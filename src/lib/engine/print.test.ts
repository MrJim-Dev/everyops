import { describe, expect, it } from "vitest";
import type { DataRecord } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { posSample } from "@/lib/catalog/canteen-pos";
import { applyOps } from "./changes";
import { computeAll } from "./compute";
import {
  escapeMarkdown,
  placeholderOptions,
  renderPrint,
  starterTemplate,
  templatesFor,
  unknownPlaceholders,
} from "./print";

// 2026-10-15 10:00 in Manila.
const NOW = new Date("2026-10-15T02:00:00Z");
const ws = posSample(NOW, "Tita Nena's Canteen");
const bp = ws.blueprint;
const records = computeAll(bp, ws.records, NOW);
const order = bp.entities.find((e) => e.id === "order");
if (!order) throw new Error("Sample changed.");
const withLines = records.find(
  (r) => r.entityId === "order" && records.some((l) => l.entityId === "order_line" && l.data.order === r.id),
) as DataRecord;

describe("print templates", () => {
  it("fills fields, links, the business, today and a line-item table", () => {
    const md = renderPrint(
      bp,
      { body: "# {{business}}\n\nOrder {{code}} · {{today}}\n\nTotal: {{total}}\n\n{{lines}}" },
      withLines,
      records,
      NOW,
    );
    expect(md).toContain("# Tita Nena's Canteen");
    expect(md).toContain("Oct 15, 2026");
    expect(md).toContain(`Order ${escapeMarkdown(String(withLines.data.code))}`);
    expect(md).toMatch(/Total: ₱[\d,]+/);
    // A GFM table: header, alignment (numbers right-aligned), one row per line.
    const table = md.split("\n").filter((l) => l.startsWith("|"));
    expect(table[0]).toContain("| Item |");
    expect(table[1]).toContain("---:");
    const lines = records.filter((l) => l.entityId === "order_line" && l.data.order === withLines.id);
    expect(table).toHaveLength(2 + lines.length);
    // The link back to the order isn't a column; the product link is shown through Item instead.
    expect(table[0]).not.toContain("Order");
    expect(table[0]).not.toContain("Product");
  });

  it("blanks placeholders that don't resolve and reports them", () => {
    const md = renderPrint(bp, { body: "A{{nope}}B{{lines:nothing}}C" }, withLines, records, NOW);
    expect(md).toBe("ABC");
    expect(unknownPlaceholders(bp, order, "{{code}} {{nope}} {{lines:order_line}} {{lines:x}}")).toEqual([
      "nope",
      "lines:x",
    ]);
  });

  it("keeps values from turning into formatting", () => {
    const evil = { ...withLines, data: { ...withLines.data, code: "<b>**x**</b> | [y](z)" } };
    const md = renderPrint(bp, { body: "{{code}}" }, evil, records, NOW);
    expect(md).toBe("\\<b\\>\\*\\*x\\*\\*\\</b\\> \\| \\[y\\](z)");
    expect(escapeMarkdown("- one\n2. two")).toBe("\\- one  \n2\\. two");
  });

  it("starts owners from a template that uses every detail and the line items", () => {
    const body = starterTemplate(bp, order, "Receipt");
    expect(body).toContain("## Receipt {{code}}");
    expect(body).toContain("**Payment:** {{payment}}");
    expect(body).toContain("{{lines}}");
    expect(unknownPlaceholders(bp, order, body)).toEqual([]);
    const tokens = placeholderOptions(bp, order).map((o) => o.token);
    expect(tokens).toContain("{{lines:order_line}}");
    expect(tokens).toContain("{{total}}");
  });

  it("are added, replaced and removed as undoable changes, and validated", () => {
    const template = { id: "receipt", entityId: "order", name: "Receipt", body: "{{code}}" };
    const added = applyOps(bp, [{ op: "add_print_template", template }]);
    expect(templatesFor(added, "order")).toEqual([template]);
    expect(bp.printTemplates ?? []).toEqual([]);
    const renamed = applyOps(added, [{ op: "add_print_template", template: { ...template, name: "Slip" } }]);
    expect(templatesFor(renamed, "order").map((t) => t.name)).toEqual(["Slip"]);
    expect(validateBlueprint(renamed)).toEqual([]);
    expect(
      templatesFor(applyOps(renamed, [{ op: "remove_print_template", templateId: "receipt" }]), "order"),
    ).toEqual([]);
    // Removing the record type removes what prints it.
    expect(applyOps(renamed, [{ op: "remove_entity", entityId: "order" }]).printTemplates).toEqual([]);
    const broken = { ...renamed, printTemplates: [{ ...template, entityId: "gone", name: " " }] };
    expect(validateBlueprint(broken).map((e) => e.message)).toEqual([
      "A print template needs a name",
      "  prints a missing record type",
    ]);
  });
});
