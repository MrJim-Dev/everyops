import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { manageToken, readManageToken } from "./manage";

const NOW = new Date("2026-10-16T02:00:00Z");
const claim = { workspace: "court-house", view: "book_court", record: "booking_abc123" };

describe("manage links", () => {
  beforeAll(() => {
    process.env.BETTER_AUTH_SECRET = "test-secret-for-manage-links";
  });

  it("name the one booking they were made for", () => {
    expect(readManageToken(manageToken(claim, NOW), NOW)).toEqual(claim);
  });

  it("stop working when changed, signed with another secret, or expired", () => {
    const token = manageToken(claim, NOW);
    const [payload, mac] = token.split(".");
    const other = Buffer.from(
      JSON.stringify({ w: "court-house", v: "book_court", r: "booking_other", e: 1_900_000_000 }),
    ).toString("base64url");
    expect(readManageToken(`${other}.${mac}`, NOW)).toBeNull();
    expect(readManageToken(`${payload}.x${mac.slice(1)}`, NOW)).toBeNull();
    expect(readManageToken(token, new Date(NOW.getTime() + 61 * 86_400_000))).toBeNull();
    process.env.BETTER_AUTH_SECRET = "a-different-secret";
    expect(readManageToken(token, NOW)).toBeNull();
    process.env.BETTER_AUTH_SECRET = "test-secret-for-manage-links";
    expect(readManageToken("not-a-token", NOW)).toBeNull();
  });
});
