import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { documentType } from "./storage";

const bytes = (s: string) => new TextEncoder().encode(s);

describe("documentType", () => {
  it("knows documents by their bytes, not their names", () => {
    expect(documentType(bytes("%PDF-1.7 ..."), "receipt.pdf")?.ext).toBe("pdf");
    expect(documentType(bytes("%PDF-1.7 ..."), "receipt.txt")?.ext).toBe("pdf");
    expect(documentType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]), "budget.xlsx")?.ext).toBe("xlsx");
    expect(documentType(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]), "archive.zip")).toBeNull();
    expect(documentType(bytes("name,amount\nAna,500\n"), "list.csv")?.mime).toContain("text/csv");
  });

  it("refuses web pages and binaries dressed up as text", () => {
    expect(documentType(bytes("<html><script>alert(1)</script>"), "notes.txt")).toBeNull();
    expect(documentType(new Uint8Array([0x61, 0, 0x62]), "notes.txt")).toBeNull();
    expect(documentType(bytes("<svg/>"), "logo.svg")).toBeNull();
  });
});
