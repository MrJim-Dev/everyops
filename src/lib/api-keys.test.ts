import { describe, expect, it } from "vitest";
import { allowedIn, keyIdOf, keyStatus, type Permission, reaches, visiblePrefix } from "./api-keys";

const key = (
  workspaces: string[] | null,
  permissions: Permission[] = ["records:read", "records:write", "design:propose"],
) => ({
  workspaces,
  permissions: [...permissions],
});

describe("API key secrets", () => {
  it("reads the key id from a well-formed secret only", () => {
    expect(keyIdOf("eo_live_ab12cd34_AbCdEfGhIjKlMnOpQrStUvWxYz012345")).toBe("ab12cd34");
    expect(keyIdOf("  eo_live_ab12cd34_AbCdEfGhIjKlMnOpQrStUvWxYz012345\n")).toBe("ab12cd34");
    expect(keyIdOf("eo_live_ab12cd34_short")).toBeNull();
    expect(keyIdOf("sk_live_ab12cd34_AbCdEfGhIjKlMnOpQrStUvWxYz012345")).toBeNull();
    expect(visiblePrefix("ab12cd34")).toBe("eo_live_ab12cd34_");
  });
});

describe("what a key may do in a workspace", () => {
  it("reaches only the workspaces it was made for, or all of them", () => {
    expect(reaches(key(["court-a"]), "court-a")).toBe(true);
    expect(reaches(key(["court-a"]), "court-b")).toBe(false);
    expect(reaches(key(null), "court-b")).toBe(true);
    expect(allowedIn(key(["court-a"]), "court-b", "owner").size).toBe(0);
  });

  it("never does more than its owner's current role allows", () => {
    expect([...allowedIn(key(null), "w", "owner")]).toEqual([
      "records:read",
      "records:write",
      "design:propose",
    ]);
    expect([...allowedIn(key(null), "w", "admin")]).toEqual([
      "records:read",
      "records:write",
      "design:propose",
    ]);
    // Made by an admin who is now staff: design proposals go on the next request.
    expect([...allowedIn(key(null), "w", "staff")]).toEqual(["records:read", "records:write"]);
    expect([...allowedIn(key(null), "w", "viewer")]).toEqual(["records:read"]);
    // The owner left the workspace.
    expect(allowedIn(key(null), "w", null).size).toBe(0);
  });

  it("lets only owners and admins apply design changes or manage the workspace", () => {
    const full = key(null, ["records:read", "design:apply", "manage"]);
    expect([...allowedIn(full, "w", "admin")]).toEqual(["records:read", "design:apply", "manage"]);
    expect([...allowedIn(full, "w", "staff")]).toEqual(["records:read"]);
  });

  it("keeps a read-only key read-only, whatever the role", () => {
    expect([...allowedIn(key(null, ["records:read"]), "w", "owner")]).toEqual(["records:read"]);
  });
});

describe("key status", () => {
  const now = new Date("2026-10-16T00:00:00Z");
  it("is expired once its expiry passes and revoked once revoked", () => {
    expect(keyStatus({ expiresAt: null, revokedAt: null }, now)).toBe("active");
    expect(keyStatus({ expiresAt: "2026-10-17T00:00:00Z", revokedAt: null }, now)).toBe("active");
    expect(keyStatus({ expiresAt: "2026-10-16T00:00:00Z", revokedAt: null }, now)).toBe("expired");
    expect(keyStatus({ expiresAt: null, revokedAt: "2026-10-01T00:00:00Z" }, now)).toBe("revoked");
  });
});
