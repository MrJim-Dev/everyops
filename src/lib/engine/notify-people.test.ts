import { describe, expect, it } from "vitest";
import type { Rule } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { describeActions, saveRuns } from "./automations";

const NOW = new Date("2026-10-22T03:00:00Z");
const { blueprint: bp, records } = courtBookingsSample(NOW);
const booking = records.find((r) => r.entityId === "booking");
if (!booking) throw new Error("sample");

const RULE: Rule = {
  id: "new_booking",
  name: "Tell the owner about new bookings",
  trigger: { entityId: "booking", event: "created" },
  actions: [
    {
      type: "notify_people",
      to: "owner, frontdesk@court.ph",
      title: "New booking: {{player.name}}",
      body: "{{court.name}}",
    },
  ],
};

describe("notify_people automations", () => {
  it("fills in who and what for the saved record, for the server to send", () => {
    const [run] = saveRuns({ ...bp, rules: [RULE] }, [{ after: booking }], records, NOW);
    const player = records.find((r) => r.id === booking.data.player);
    const court = records.find((r) => r.id === booking.data.court);
    expect(run.alerts).toEqual([
      {
        to: "owner, frontdesk@court.ph",
        title: `New booking: ${player?.data.name}`,
        body: String(court?.data.name),
        email: false,
        recordId: booking.id,
      },
    ]);
    expect(run.emails).toEqual([]);
  });

  it("notifies from the branch an if / else automation takes", () => {
    const branched: Rule = {
      ...RULE,
      actions: [],
      branches: [
        {
          when: "status == 'nope'",
          actions: [{ type: "notify_people", to: "owner", title: "Wrong branch" }],
        },
        { actions: [{ type: "notify_people", to: "owner", title: "Otherwise: {{player.name}}" }] },
      ],
    };
    const [run] = saveRuns({ ...bp, rules: [branched] }, [{ after: booking }], records, NOW);
    expect(run.alerts.map((a) => a.title)).toEqual([expect.stringMatching(/^Otherwise: /)]);
  });

  it("is described in Settings and checked by validation", () => {
    expect(describeActions(bp, RULE)).toEqual([
      "Notify owner, frontdesk@court.ph: New booking: {{player.name}}",
    ]);
    const bad: Rule = { ...RULE, actions: [{ type: "notify_people", to: "the boss, {{nope}}", title: "" }] };
    const messages = validateBlueprint({ ...bp, rules: [bad] })
      .map((e) => e.message)
      .join("\n");
    expect(messages).toMatch(/no title/);
    expect(messages).toMatch(/"the boss" isn't someone to notify/);
    expect(messages).toMatch(/\{\{nope\}\} isn't a field/);
    expect(validateBlueprint({ ...bp, rules: [RULE] }).filter((e) => e.path.startsWith("rules"))).toEqual([]);
  });

  it("fills formulas in placeholders and doesn't double a currency written before an amount", () => {
    const rule: Rule = {
      ...RULE,
      actions: [
        {
          type: "notify_people",
          to: "{{player.email ? player.email : 'desk@court.ph'}}",
          title: "Paid ₱{{amount}}",
          body: "S$ {{amount}} · {{court.name}}",
        },
      ],
    };
    const [run] = saveRuns({ ...bp, rules: [rule] }, [{ after: booking }], records, NOW);
    expect(run.alerts[0].to).toBe("desk@court.ph");
    expect(run.alerts[0].title).toMatch(/^Paid ₱\d/);
    expect(run.alerts[0].title).not.toMatch(/₱₱/);
  });
});
