import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./db", () => ({ db: {} }));

import { recipients } from "./notifications";

const team = [
  { id: "u_owner", email: "ana@court.ph", role: "owner" as const },
  { id: "u_admin", email: "ben@court.ph", role: "admin" as const },
  { id: "u_staff", email: "cy@court.ph", role: "staff" as const },
];
const alert = (to: string, email = false) => ({ to, title: "New booking", body: "", email, recordId: "b1" });
const ids = (r: ReturnType<typeof recipients>) => r.members.map((m) => m.id).sort();

describe("notification recipients", () => {
  it("reads roles: owner, admins (with the owner), staff and the whole team", () => {
    expect(ids(recipients(alert("owner"), team))).toEqual(["u_owner"]);
    expect(ids(recipients(alert("admins"), team))).toEqual(["u_admin", "u_owner"]);
    expect(ids(recipients(alert("staff"), team))).toEqual(["u_staff"]);
    expect(ids(recipients(alert("team"), team))).toEqual(["u_admin", "u_owner", "u_staff"]);
  });

  it("notifies a member by their address in the app, and emails everyone else", () => {
    const r = recipients(alert("owner, Cy@court.ph, juan@gmail.com"), team);
    expect(ids(r)).toEqual(["u_owner", "u_staff"]);
    expect(r.emails).toEqual(["juan@gmail.com"]);
  });

  it("emails members too when the automation asks, once each", () => {
    expect(recipients(alert("owner, admins", true), team).emails.sort()).toEqual([
      "ana@court.ph",
      "ben@court.ph",
    ]);
  });

  it("skips what isn't anyone: blanks and a placeholder that filled in empty", () => {
    expect(recipients(alert(" , nobody, "), team)).toEqual({ members: [], emails: [] });
  });
});
