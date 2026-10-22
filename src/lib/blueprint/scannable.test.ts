import { describe, expect, it } from "vitest";
import { isScannable, sameCode } from "./scannable";
import type { Field } from "./types";

const text = (name: string, type: Field["type"] = "text") =>
  ({ id: name.toLowerCase(), name, type }) as Field;

describe("scannable fields", () => {
  it("reads code fields from their names", () => {
    for (const name of [
      "Barcode",
      "Bar code",
      "SKU",
      "UPC",
      "EAN",
      "QR code",
      "Serial number",
      "Serial no.",
      "Asset tag",
      "ISBN",
      "Product code",
      "Item no.",
      "Tracking number",
    ])
      expect(isScannable(text(name)), name).toBe(true);
  });

  it("leaves other fields, and non-text fields named like codes", () => {
    for (const name of ["Name", "Discount code", "Barcoded?", "Postal code"])
      expect(isScannable(text(name)), name).toBe(false);
    expect(isScannable(text("Barcode", "number"))).toBe(false);
  });

  it("matches a scan whatever its spacing and letter case", () => {
    expect(sameCode(" ab-12 ", "AB-12")).toBe(true);
    expect(sameCode(4800016644405, "4800016644405")).toBe(false);
  });
});
