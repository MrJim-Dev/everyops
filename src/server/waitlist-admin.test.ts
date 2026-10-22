import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  APPROVE_LINK_DAYS,
  approvalToken,
  isSiteAdmin,
  readApprovalToken,
  siteAdmins,
} from "./waitlist-admin";

const SECRET = "test-secret-test-secret-test-secret-1234";
const NOW = Date.UTC(2026, 9, 23);

describe("site admins", () => {
  it("default to James and Jared and read SITE_ADMIN_EMAILS loosely", () => {
    expect(siteAdmins({})).toEqual(["james@everyops.app", "jared@everyops.app"]);
    expect(isSiteAdmin("jared@everyops.app", {})).toBe(true);
    expect(siteAdmins({ SITE_ADMIN_EMAILS: " A@x.com, b@x.com;a@x.com " })).toEqual(["a@x.com", "b@x.com"]);
    expect(isSiteAdmin("James@EveryOps.app", {})).toBe(true);
    expect(isSiteAdmin("someone@x.com", {})).toBe(false);
    expect(isSiteAdmin(null, {})).toBe(false);
  });
});

describe("approve links", () => {
  it("approve the email they were made for, until they expire", () => {
    const token = approvalToken("New.Person@example.com", NOW, SECRET);
    expect(readApprovalToken(token, NOW + 1000, SECRET)).toBe("new.person@example.com");
    expect(readApprovalToken(token, NOW + APPROVE_LINK_DAYS * 86_400_000 + 1, SECRET)).toBeNull();
  });

  it("refuse an altered email, another secret, or no secret", () => {
    const token = approvalToken("a@example.com", NOW, SECRET);
    const [, mac] = token.split(".");
    const forged = `${Buffer.from(`b@example.com|${NOW + 86_400_000}`).toString("base64url")}.${mac}`;
    expect(readApprovalToken(forged, NOW, SECRET)).toBeNull();
    expect(readApprovalToken(token, NOW, "another-secret-another-secret-12345")).toBeNull();
    expect(readApprovalToken(token, NOW, "")).toBeNull();
    expect(readApprovalToken("garbage", NOW, SECRET)).toBeNull();
  });
});
