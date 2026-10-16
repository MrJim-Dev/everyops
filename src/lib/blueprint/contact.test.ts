import { describe, expect, it } from "vitest";
import { fileName, isEmail, isFilePath, isPhone, normalizeUrl, telHref } from "./contact";

describe("contact values", () => {
  it("checks email addresses and phone numbers the way people write them", () => {
    expect(isEmail("ana@courthouse.ph")).toBe(true);
    expect(isEmail("ana@courthouse")).toBe(false);
    expect(isEmail("ana courthouse.ph")).toBe(false);
    expect(isPhone("0917 555 0123")).toBe(true);
    expect(isPhone("+63 (2) 8123-4567")).toBe(true);
    expect(isPhone("12345")).toBe(false);
    expect(isPhone("call me")).toBe(false);
    expect(telHref("+63 917-555-0123")).toBe("tel:+639175550123");
  });

  it("opens bare domains as https and refuses other schemes", () => {
    expect(normalizeUrl("courthouse.ph/book")).toBe("https://courthouse.ph/book");
    expect(normalizeUrl("http://example.com")).toBe("http://example.com/");
    expect(normalizeUrl("javascript:alert(1)")).toBeUndefined();
    expect(normalizeUrl("not a link")).toBeUndefined();
  });

  it("only takes the workspace's own document uploads, and keeps their names", () => {
    const path =
      "/api/files/court-house/docs/0b6f3c55-8f0e-4c55-9f53-7c2d5c3a1e10.pdf?name=Receipt%20Oct.pdf";
    expect(isFilePath(path)).toBe(true);
    expect(fileName(path)).toBe("Receipt Oct.pdf");
    expect(isFilePath("/api/files/court-house/docs/0b6f3c55-8f0e-4c55-9f53-7c2d5c3a1e10.html")).toBe(false);
    expect(isFilePath("https://elsewhere.test/receipt.pdf")).toBe(false);
    expect(fileName("/api/files/court-house/docs/0b6f3c55-8f0e-4c55-9f53-7c2d5c3a1e10.xlsx")).toBe(
      "File.xlsx",
    );
  });
});
