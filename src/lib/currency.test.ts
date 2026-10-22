import { describe, expect, it } from "vitest";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { posSample } from "@/lib/catalog/canteen-pos";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { fillTemplate } from "@/lib/engine/automations";
import { applyOps } from "@/lib/engine/changes";
import { computeAll } from "@/lib/engine/compute";
import { parseNumber } from "@/lib/engine/import";
import { formatCell, siteOf } from "@/lib/public/resolve";
import { currencyOf, currencySymbol, formatMoney, looksLikeMoney, stripMoney } from "./format";

const NOW = new Date("2026-10-15T02:00:00Z");

describe("workspace currency", () => {
  it("formats money in the currency named, pesos by default", () => {
    expect(formatMoney(1250)).toBe("₱1,250");
    expect(formatMoney(1250.5)).toBe("₱1,250.50");
    expect(formatMoney(1250, { currency: "USD" })).toBe("$1,250");
    // Ringgit puts a no-break space after RM.
    expect(formatMoney(1250.5, { currency: "MYR" })).toBe("RM\u00a01,250.50");
    // Yen has no cents.
    expect(formatMoney(1250.4, { currency: "JPY" })).toBe("￥1,250");
    expect(formatMoney(-40, { currency: "EUR" })).toBe("−€40");
    // Something unknown reads as pesos rather than throwing.
    expect(formatMoney(5, { currency: "XYZ" })).toBe("₱5");
    // Dollars outside the US say whose.
    expect(formatMoney(400, { currency: "SGD" })).toBe("S$400");
    expect(formatMoney(80.5, { currency: "HKD" })).toBe("HK$80.50");
    expect(currencySymbol("SGD")).toBe("S$");
    expect(currencySymbol("USD")).toBe("$");
    expect(currencySymbol("PHP")).toBe("₱");
  });

  it("treats older workspaces as pesos", () => {
    expect(currencyOf({})).toBe("PHP");
    expect(currencyOf({ currency: "SGD" })).toBe("SGD");
    expect(currencyOf({ currency: "nope" })).toBe("PHP");
  });

  it("reads pasted amounts in any currency", () => {
    expect(stripMoney("S$ 1,250.50")).toBe("1250.50");
    expect(stripMoney("HK$80")).toBe("80");
    expect(parseNumber("RM 300")).toBe(300);
    expect(parseNumber("USD 99")).toBe(99);
    expect(parseNumber("₱1,250.50")).toBe(1250.5);
    expect(parseNumber("€(40)")).toBe(-40);
    expect(parseNumber("P 500")).toBe(500);
    expect(looksLikeMoney("From S$12")).toBe(true);
    expect(looksLikeMoney("Rp 50.000")).toBe(true);
    expect(looksLikeMoney("12 seats")).toBe(false);
  });

  it("is an undoable design change, validated", () => {
    const { blueprint } = posSample(NOW);
    const next = applyOps(blueprint, [{ op: "set_currency", currency: "SGD" }]);
    expect(next.currency).toBe("SGD");
    expect(blueprint.currency).toBeUndefined();
    expect(validateBlueprint(next)).toEqual([]);
    expect(validateBlueprint({ ...next, currency: "DOGE" }).map((e) => e.path)).toEqual(["currency"]);
  });

  it("carries into emails, public pages and the public site", () => {
    const ws = posSample(NOW, "Kopi Corner");
    const bp = { ...ws.blueprint, currency: "SGD" };
    const records = computeAll(bp, ws.records, NOW);
    const lineType = bp.entities.find((e) => e.id === "order_line");
    const line = records.find((r) => r.entityId === "order_line");
    const price = lineType?.fields.find((f) => f.id === "price");
    if (!lineType || !line || !price) throw new Error("Sample changed.");
    expect(fillTemplate("Price {{price}}", bp, lineType, line.data, records, NOW)).toMatch(/^Price S\$\d/);
    expect(formatCell(bp, records, price, 135).text).toBe("S$135");
    expect(formatCell(ws.blueprint, records, price, 135).text).toBe("₱135");
    const sample = courtBookingsSample(NOW).blueprint;
    // A site needs a public page: the booking form, shared.
    const court = {
      blueprint: {
        ...sample,
        views: sample.views.map((v) => (v.type === "form" ? { ...v, public: true } : v)),
      },
    };
    expect(siteOf("court", "Court", { ...court.blueprint, currency: "SGD" })?.currency).toBe("SGD");
    expect(siteOf("court", "Court", court.blueprint)?.currency).toBe("PHP");
  });
});
