import { describe, expect, it } from "vitest";
import { mappingByHeader, mappingForHeaders } from "./sheet-sync";

describe("sheet sync mapping", () => {
  it("saves the mapping by header and lays it onto reordered columns", () => {
    const saved = mappingByHeader(["Name", "Phone", "Notes"], ["name", "phone", null]);
    expect(saved).toEqual([
      { header: "Name", fieldId: "name" },
      { header: "Phone", fieldId: "phone" },
    ]);
    expect(mappingForHeaders(["Phone ", "Email", "name"], saved)).toEqual({
      mapping: ["phone", null, "name"],
      missing: [],
    });
  });

  it("reports mapped columns the sheet lost", () => {
    expect(
      mappingForHeaders(
        ["Name"],
        [
          { header: "Name", fieldId: "name" },
          { header: "Phone", fieldId: "phone" },
        ],
      ).missing,
    ).toEqual(["Phone"]);
  });
});
