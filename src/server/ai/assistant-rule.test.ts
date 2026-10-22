import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { toAssistantRule } from "./assistant-rule";

describe("toAssistantRule", () => {
  it("reads a timed email automation from setup's reused fields", () => {
    const rule = toAssistantRule({
      id: "reminder",
      name: "Day-before reminder",
      trigger: { entityId: "bookings", event: "date_reached", fieldId: "date", to: "-1 9:00" },
      actions: [{ type: "send_email", fieldId: "{{email}}", value: "See you tomorrow\n\nHi {{name}}" }],
    });
    expect(rule).toEqual({
      id: "reminder",
      name: "Day-before reminder",
      trigger: { entityId: "bookings", event: "date_reached", fieldId: "date", offsetDays: -1, at: "09:00" },
      actions: [{ type: "send_email", to: "{{email}}", subject: "See you tomorrow", body: "Hi {{name}}" }],
    });
  });

  it("takes a separate message as the body when Gemini writes one", () => {
    const rule = toAssistantRule({
      id: "r",
      name: "R",
      trigger: { entityId: "bookings", event: "created" },
      actions: [{ type: "send_email", fieldId: "a@b.test", value: "Booked", message: "Thanks" }],
    });
    expect(rule.actions).toEqual([{ type: "send_email", to: "a@b.test", subject: "Booked", body: "Thanks" }]);
  });

  it("reads schedules and create_record values, and leaves what doesn't read for validation", () => {
    const rule = toAssistantRule({
      id: "invoice",
      name: "Invoice",
      trigger: { entityId: "bookings", event: "schedule", to: "weekly mon 08:00" },
      actions: [
        { type: "create_record", fieldId: "invoices", value: '{"amount":"price"}' },
        { type: "create_record", fieldId: "invoices", value: "not json" },
        { type: "send_sms", message: "hi" },
      ],
    });
    expect(rule.trigger).toEqual({
      entityId: "bookings",
      event: "schedule",
      schedule: { every: "week", at: "08:00", weekday: 1 },
    });
    expect(rule.actions).toEqual([
      { type: "create_record", entityId: "invoices", values: { amount: "price" } },
      { type: "create_record", entityId: "invoices", values: {} },
      { type: "notify", message: "" },
    ]);
  });

  it("keeps status changes as they were", () => {
    const rule = toAssistantRule({
      id: "s",
      name: "S",
      trigger: { entityId: "bookings", event: "status_changed", fieldId: "status", to: "paid" },
      actions: [{ type: "notify", message: "Paid" }],
    });
    expect(rule.trigger).toEqual({
      entityId: "bookings",
      event: "status_changed",
      fieldId: "status",
      to: "paid",
    });
  });
  it("reads call_api: the webhook endpoint in fieldId, the JSON to post in value", () => {
    const rule = toAssistantRule({
      id: "ping",
      name: "Tell Slack",
      trigger: { entityId: "player", event: "created" },
      actions: [{ type: "call_api", fieldId: "ep_9", value: '{"text": "{{name}} joined"}' }],
    });
    expect(rule.actions).toEqual([
      { type: "call_api", endpointId: "ep_9", body: '{"text": "{{name}} joined"}' },
    ]);
    const plain = toAssistantRule({
      id: "ping",
      name: "Send the record",
      trigger: { entityId: "player", event: "created" },
      actions: [{ type: "call_api", fieldId: "ep_9", value: "" }],
    });
    expect(plain.actions).toEqual([{ type: "call_api", endpointId: "ep_9" }]);
  });
  it("reads if / else_if / else steps as branches", () => {
    const rule = toAssistantRule({
      id: "follow_up",
      name: "Follow up",
      trigger: { entityId: "bookings", event: "updated" },
      actions: [
        { type: "notify", message: "Saved" },
        { type: "if", value: "status == 'paid'" },
        { type: "send_email", fieldId: "{{email}}", value: "Thanks\n\nSee you" },
        { type: "else if", value: "status == 'unpaid'" },
        { type: "set_field", fieldId: "note", value: "'chase'" },
        { type: "else" },
        { type: "notify", message: "Nothing to do" },
      ],
    });
    expect(rule.actions).toEqual([{ type: "notify", message: "Saved" }]);
    expect(rule.branches).toEqual([
      {
        when: "status == 'paid'",
        actions: [{ type: "send_email", to: "{{email}}", subject: "Thanks", body: "See you" }],
      },
      {
        when: "status == 'unpaid'",
        actions: [{ type: "set_field", target: { kind: "self" }, fieldId: "note", value: "'chase'" }],
      },
      { actions: [{ type: "notify", message: "Nothing to do" }] },
    ]);
  });
});
