import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

beforeAll(() => {
  process.env.CONNECTIONS_KEY = "test-key-for-sealing-connection-tokens";
});

describe("secret box", () => {
  it("seals and opens, and refuses tampered values", async () => {
    const { seal, unseal } = await import("./secret-box");
    const sealed = seal("ya29.refresh-token");
    expect(sealed).toMatch(/^v1\./);
    expect(sealed).not.toContain("refresh-token");
    expect(unseal(sealed)).toBe("ya29.refresh-token");
    const parts = sealed.split(".");
    parts[3] = Buffer.from("other").toString("base64url");
    expect(() => unseal(parts.join("."))).toThrow();
    expect(seal("same")).not.toBe(seal("same"));
  });
});
