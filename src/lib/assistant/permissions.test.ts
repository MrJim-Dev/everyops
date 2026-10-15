import { describe, expect, it } from "vitest";
import type { ChangePlan } from "@/lib/engine/changes";
import { type AssistantPermissions, appliesOnItsOwn, normalizePermissions } from "./permissions";

const data: Pick<ChangePlan, "ops" | "recordOps" | "teamOps"> = {
  ops: [],
  recordOps: [{ op: "update_record", recordId: "booking_1", patch: { status: "paid" } }],
};
const design: Pick<ChangePlan, "ops" | "recordOps" | "teamOps"> = {
  ops: [{ op: "rename_system", systemId: "players", name: "Members" }],
};
const deleting: Pick<ChangePlan, "ops" | "recordOps" | "teamOps"> = {
  ops: [],
  recordOps: [{ op: "delete_record", recordId: "booking_1" }],
};
const inviting: Pick<ChangePlan, "ops" | "recordOps" | "teamOps"> = {
  ops: [],
  teamOps: [{ op: "invite", email: "mia@example.com", role: "staff" }],
};
const at = (autonomy: AssistantPermissions["autonomy"], confirmDeletes = true): AssistantPermissions => ({
  autonomy,
  confirmDeletes,
  learn: true,
});

describe("appliesOnItsOwn", () => {
  it("never applies on its own when asking for approval or read only", () => {
    for (const plan of [data, design]) {
      expect(appliesOnItsOwn(plan, at("ask"))).toBe(false);
      expect(appliesOnItsOwn(plan, at("read_only"))).toBe(false);
    }
  });

  it("auto-applies data but holds design changes back at Auto-apply data", () => {
    expect(appliesOnItsOwn(data, at("auto_data"))).toBe(true);
    expect(appliesOnItsOwn(design, at("auto_data"))).toBe(false);
  });

  it("applies design at Full autonomy, but removals wait unless allowed and team changes always wait", () => {
    expect(appliesOnItsOwn(design, at("autonomous"))).toBe(true);
    expect(appliesOnItsOwn(deleting, at("autonomous"))).toBe(false);
    expect(appliesOnItsOwn(deleting, at("autonomous", false))).toBe(true);
    expect(appliesOnItsOwn(inviting, at("autonomous", false))).toBe(false);
  });
});

describe("normalizePermissions", () => {
  it("fills in the defaults for missing or unknown settings", () => {
    expect(normalizePermissions({})).toEqual({ autonomy: "ask", confirmDeletes: true, learn: true });
    expect(normalizePermissions({ autonomy: "yolo", learn: false })).toEqual({
      autonomy: "ask",
      confirmDeletes: true,
      learn: false,
    });
  });
});
