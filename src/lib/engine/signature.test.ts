import { describe, expect, it } from "vitest";
import { isSignaturePath } from "@/lib/blueprint/contact";
import type { Blueprint, DataRecord, Entity, FormView } from "@/lib/blueprint/types";
import { f } from "@/lib/catalog/define";
import { personalField } from "@/lib/components/public-safety";
import { customBookingHtml } from "@/lib/public/booking-page";
import { paletteFor } from "@/lib/public/custom-site";
import { formatCell, publicFieldsOf } from "@/lib/public/resolve";
import { fillTemplate } from "./automations";
import { coerceValues } from "./coerce";
import { validateRecord } from "./records";
import { valueText } from "./value-text";

const NOW = new Date("2026-10-15T02:00:00Z");
const SIGNED = "/api/files/kayak-rentals/docs/0b6c5a8e-2f1d-4c3a-9e7b-1a2b3c4d5e6f.png?name=Signature.png";
const waiver: Entity = {
  id: "waiver",
  name: "Waiver",
  pluralName: "Waivers",
  primaryFieldId: "name",
  fields: [
    f.text("name", "Name", { required: true }),
    { id: "signature", name: "Signature", type: "signature", required: true },
  ],
};
const form: FormView = {
  id: "sign_waiver",
  entityId: "waiver",
  name: "Sign the waiver",
  type: "form",
  fieldIds: [],
  public: true,
};
const bp: Blueprint = {
  version: 1,
  workspaceName: "Kayak rentals",
  systems: [],
  entities: [waiver],
  views: [form],
  widgets: [],
  rules: [],
};
const records: DataRecord[] = [];
const field = waiver.fields[1];

describe("signature fields", () => {
  it("hold a PNG in the workspace's private documents (or, in previews, in the page)", () => {
    expect(isSignaturePath(SIGNED)).toBe(true);
    expect(isSignaturePath(SIGNED.replace(".png", ".pdf"))).toBe(false);
    expect(isSignaturePath("/api/files/kayak-rentals/0b6c5a8e-2f1d-4c3a-9e7b-1a2b3c4d5e6f.png")).toBe(false);
    const drawn = `data:image/png;base64,${"A".repeat(200)}`;
    expect(isSignaturePath(drawn)).toBe(false);
    expect(isSignaturePath(drawn, { preview: true })).toBe(true);
  });

  it("are required like any field and refuse anything that isn't a signature", () => {
    expect(validateRecord(bp, waiver, { name: "Ana", signature: SIGNED }, records)).toEqual([]);
    expect(validateRecord(bp, waiver, { name: "Ana" }, records)[0]?.message).toBe("Signature is required");
    expect(
      validateRecord(bp, waiver, { name: "Ana", signature: "https://evil.example/sig.png" }, records)[0]
        ?.message,
    ).toBe("Sign signature again");
    expect(coerceValues(bp, records, waiver, { signature: SIGNED }).errors[0]).toContain("signature pad");
  });

  it("are asked on public forms but never shown publicly", () => {
    expect(publicFieldsOf(bp, form).map((x) => x.id)).toEqual(["name", "signature"]);
    expect(personalField(bp, field)).toBe(true);
    expect(formatCell(bp, records, field, SIGNED)).toMatchObject({ kind: "text", text: "Signed" });
    expect(valueText(bp, records, field, SIGNED)).toBe("Signed");
    expect(
      fillTemplate("{{name}}: {{signature}}", bp, waiver, { name: "Ana", signature: SIGNED }, records, NOW),
    ).toBe("Ana: Signed");
  });

  it("leave the booking page's script valid JavaScript", () => {
    const html = customBookingHtml({
      name: "Kayak rentals",
      formId: "sign_waiver",
      homeHref: "/s/kayak-rentals",
      heading: "Rent a kayak",
      palette: paletteFor("Kayak"),
    });
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? "";
    expect(script).toContain('case "signature"');
    expect(() => new Function(script)).not.toThrow();
  });
});
