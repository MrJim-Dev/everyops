import { describe, expect, it } from "vitest";
import type { Rule } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { applyActions, saveRuns } from "./automations";
import { allActions } from "./branches";

const NOW = new Date("2026-10-22T03:00:00Z");
const { blueprint: bp, records } = courtBookingsSample(NOW);
const booking = records.find((r) => r.entityId === "booking" && r.data.status === "paid");
if (!booking) throw new Error("sample");
const withStatus = (status: string) => ({ ...booking, data: { ...booking.data, status } });

const RULE: Rule = {
  id: "follow_up",
  name: "Follow up on a booking",
  trigger: { entityId: "booking", event: "updated" },
  actions: [{ type: "set_field", target: { kind: "self" }, fieldId: "source", value: "'phone'" }],
  branches: [
    {
      when: "status == 'paid'",
      actions: [
        { type: "send_email", to: "front@desk.test", subject: "Paid: {{player.name}}", body: "Thanks" },
      ],
    },
    {
      when: "status == 'unpaid'",
      actions: [
        { type: "send_email", to: "front@desk.test", subject: "Unpaid: {{player.name}}", body: "Chase" },
      ],
    },
    { actions: [{ type: "set_field", target: { kind: "self" }, fieldId: "method", value: "'cash'" }] },
  ],
};
const ws = { ...bp, rules: [RULE] };

describe("if / else in automations", () => {
  it("runs the first branch that holds, after the rule's own actions", () => {
    const paid = applyActions(ws, records, RULE, withStatus("paid"), NOW);
    expect(paid.records.find((r) => r.id === booking.id)?.data.method).toBe(booking.data.method);
  });

  it("sends the email of the branch the saved record took", () => {
    const runs = saveRuns(ws, [{ before: withStatus("paid"), after: withStatus("unpaid") }], records, NOW);
    expect(runs.flatMap((r) => r.emails.map((e) => e.subject))).toEqual([expect.stringMatching(/^Unpaid: /)]);
  });

  it("validates each branch: conditions, actions, and the otherwise last", () => {
    const bad: Rule = {
      ...RULE,
      branches: [{ actions: [{ type: "notify", message: "x" }] }, { when: "status ==", actions: [] }],
    };
    const messages = validateBlueprint({ ...bp, rules: [bad] })
      .map((e) => e.message)
      .join("\n");
    expect(messages).toMatch(/only the last one can be the otherwise/);
    expect(messages).toMatch(/is invalid/);
    expect(messages).toMatch(/branch has no actions/);
    expect(validateBlueprint(ws).filter((e) => e.path.startsWith("rules"))).toEqual([]);
  });

  it("lists every action a rule can run, in any branch", () => {
    expect(allActions(RULE).map((a) => a.type)).toEqual([
      "set_field",
      "send_email",
      "send_email",
      "set_field",
    ]);
  });
});
