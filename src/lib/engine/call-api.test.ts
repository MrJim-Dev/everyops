import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord, Rule } from "@/lib/blueprint/types";
import { validateBlueprint } from "@/lib/blueprint/validate";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { applyActions, callBody, describeActions, saveRuns } from "./automations";
import { computeAll } from "./compute";

const NOW = new Date("2026-10-15T02:00:00Z");
const ws = courtBookingsSample(NOW, "Court House PH");
const player = ws.blueprint.entities.find((e) => e.id === "player");
if (!player) throw new Error("Sample changed.");

const rule = (actions: Rule["actions"]): Rule => ({
  id: "tell_slack",
  name: "Tell Slack about new players",
  trigger: { entityId: "player", event: "created" },
  actions,
});
const withRule = (r: Rule): Blueprint => ({ ...ws.blueprint, rules: [r] });
const records = computeAll(ws.blueprint, ws.records, NOW);
const someone = (name: string): DataRecord => ({
  id: "p_new",
  entityId: "player",
  data: { name },
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
});

describe("call_api automations", () => {
  it("post the record by default, shaped like a webhook event", () => {
    const r = rule([{ type: "call_api", endpointId: "ep_1" }]);
    const body = callBody(withRule(r), r, {}, player, someone("Rhea"), records, NOW) as Record<
      string,
      unknown
    >;
    expect(body).toEqual({ automation: r.name, recordType: "player", record: { id: "p_new", name: "Rhea" } });
  });

  it("fill a JSON template with placeholders escaped, so a name can't break it", () => {
    const r = rule([{ type: "call_api", endpointId: "ep_1", body: '{"text": "New player: {{name}}"}' }]);
    expect(
      callBody(
        withRule(r),
        r,
        r.actions[0] as { body?: string },
        player,
        someone('Rhea "RJ"\nCruz'),
        records,
        NOW,
      ),
    ).toEqual({
      text: 'New player: Rhea "RJ"\nCruz',
    });
    // Text that isn't JSON still goes, as {"text": …}.
    expect(callBody(withRule(r), r, { body: "Hi {{name}}" }, player, someone("Rhea"), records, NOW)).toEqual({
      text: "Hi Rhea",
    });
  });

  it("are collected on save and when an automation runs, like emails", () => {
    const r = rule([{ type: "call_api", endpointId: "ep_1", body: '{"text": "{{name}} joined"}' }]);
    const bp = withRule(r);
    const runs = saveRuns(bp, [{ after: someone("Rhea") }], records, NOW);
    expect(runs[0]?.calls).toEqual([{ endpointId: "ep_1", body: { text: "Rhea joined" } }]);
    expect(applyActions(bp, records, r, someone("Ben"), NOW).calls).toEqual([
      { endpointId: "ep_1", body: { text: "Ben joined" } },
    ]);
    expect(describeActions(bp, r, { ep_1: "Slack #front-desk" })).toEqual([
      "Call Slack #front-desk with a custom message",
    ]);
  });

  it("are checked: an endpoint, real fields, and JSON", () => {
    expect(
      validateBlueprint(
        withRule(rule([{ type: "call_api", endpointId: "ep_1", body: '{"text": "{{name}}"}' }])),
      ),
    ).toEqual([]);
    const problems = validateBlueprint(
      withRule(rule([{ type: "call_api", endpointId: "", body: '{"text": {{nope}}' }])),
    ).map((e) => e.message);
    expect(problems.join(" ")).toContain("call_api needs endpointId");
    expect(problems.join(" ")).toContain("{{nope}} isn't a field of Player");
    expect(problems.join(" ")).toContain("the call body isn't JSON");
  });
});
