import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { toEntity } from "./design";

describe("toEntity field types", () => {
  it("types plainly named contact fields and reads rollup and formula settings written as text", () => {
    const entity = toEntity({
      id: "client",
      name: "Client",
      pluralName: "Clients",
      primaryFieldId: "name",
      fields: [
        { id: "name", name: "Name", type: "text" },
        { id: "email", name: "Email", type: "text" },
        { id: "mobile", name: "Mobile number", type: "text" },
        { id: "site", name: "Website", type: "text" },
        { id: "email_template", name: "Email template", type: "text" },
        { id: "contract", name: "Contract", type: "file" },
        { id: "total", name: "Total", type: "formula", formula: { expr: "1", resultType: " Money " } },
        {
          id: "paid",
          name: "Paid",
          type: "rollup",
          rollup: {
            childEntityId: "payment",
            viaFieldId: "client",
            op: "SUM",
            fieldId: "amount",
            filter: "paid",
          },
        },
      ],
    } as Parameters<typeof toEntity>[0]);
    expect(entity.fields.map((f) => f.type)).toEqual([
      "text",
      "email",
      "phone",
      "url",
      "text",
      "file",
      "formula",
      "rollup",
    ]);
    expect(entity.fields[6].formula?.resultType).toBe("money");
    expect(entity.fields[7].rollup).toMatchObject({ op: "sum", filter: "paid" });
  });
});
describe("signature fields from the designer", () => {
  it("turns a file field named like a signature into a signature pad, and leaves other files alone", () => {
    const entity = toEntity({
      id: "rental",
      name: "Rental",
      pluralName: "Rentals",
      primaryFieldId: "renter",
      fields: [
        { id: "renter", name: "Renter", type: "text" },
        { id: "sig", name: "Renter signature", type: "file" },
        { id: "sig2", name: "Signature", type: "file" },
        { id: "contract", name: "Signed contract", type: "file" },
        { id: "staff", name: "Staff signature", type: "file" },
        { id: "when", name: "Signature date", type: "file" },
      ],
    } as never);
    expect(entity.fields.map((f) => f.type)).toEqual([
      "text",
      "signature",
      "signature",
      "file",
      "signature",
      "file",
    ]);
  });
});
