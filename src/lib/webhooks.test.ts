import { describe, expect, it } from "vitest";
import type { Blueprint, DataRecord } from "@/lib/blueprint/types";
import { signature, verifySignature } from "./webhook-signature";
import { eventsFor, isPrivateAddress, nextAttempt, urlProblem, wants } from "./webhooks";

const bp = {
  entities: [
    {
      id: "booking",
      name: "Booking",
      pluralName: "Bookings",
      fields: [
        { id: "name", name: "Name", type: "text" },
        {
          id: "status",
          name: "Status",
          type: "status",
          options: [
            { id: "pending", label: "Pending" },
            { id: "confirmed", label: "Confirmed" },
          ],
        },
      ],
    },
  ],
} as unknown as Blueprint;

const rec = (data: Record<string, unknown>): DataRecord => ({
  id: "b1",
  entityId: "booking",
  data: data as DataRecord["data"],
  createdAt: "",
  updatedAt: "",
});

describe("eventsFor", () => {
  it("turns creates, updates and deletes into events, with a status change of its own", () => {
    const events = eventsFor(bp, [
      { after: rec({ name: "A", status: "pending" }) },
      { before: rec({ name: "A", status: "pending" }), after: rec({ name: "A", status: "confirmed" }) },
      { before: rec({ name: "A" }) },
    ]);
    expect(events.map((e) => e.type)).toEqual([
      "record.created",
      "record.updated",
      "record.status_changed",
      "record.deleted",
    ]);
    expect(events[1].data.changedFields).toEqual(["status"]);
    expect(events[2].data).toMatchObject({
      from: "pending",
      to: "confirmed",
      fromLabel: "Pending",
      toLabel: "Confirmed",
    });
    expect(events[0].data.record).toEqual({ id: "b1", name: "A", status: "pending" });
  });

  it("sends nothing for a save that changed nothing", () => {
    expect(eventsFor(bp, [{ before: rec({ name: "A" }), after: rec({ name: "A" }) }])).toEqual([]);
  });

  it("filters by event and record type", () => {
    const [created] = eventsFor(bp, [{ after: rec({ name: "A" }) }]);
    expect(wants({ events: ["record.created"], entityIds: null }, created)).toBe(true);
    expect(wants({ events: ["record.created"], entityIds: ["player"] }, created)).toBe(false);
    expect(wants({ events: ["record.deleted"], entityIds: null }, created)).toBe(false);
  });
});

describe("signatures", () => {
  it("verifies its own signature and rejects tampering and replays", () => {
    const body = '{"id":"evt_1"}';
    const at = Date.UTC(2026, 9, 16, 4);
    const header = signature("whsec_test", body, at);
    expect(verifySignature("whsec_test", body, header, at)).toBe(true);
    expect(verifySignature("whsec_test", '{"id":"evt_2"}', header, at)).toBe(false);
    expect(verifySignature("whsec_other", body, header, at)).toBe(false);
    expect(verifySignature("whsec_test", body, header, at + 10 * 60_000)).toBe(false);
  });
});

describe("retries", () => {
  it("backs off, then gives up after the schedule or 24 hours", () => {
    const created = new Date("2026-10-16T00:00:00Z");
    expect(nextAttempt(1, created, created)?.toISOString()).toBe("2026-10-16T00:01:00.000Z");
    expect(nextAttempt(5, created, created)?.toISOString()).toBe("2026-10-16T01:00:00.000Z");
    expect(nextAttempt(10, created, created)).toBeNull();
    expect(nextAttempt(2, created, new Date("2026-10-16T23:58:00Z"))).toBeNull();
  });
});

describe("URL safety", () => {
  it.each([
    ["http://example.com/hook", /https/],
    ["https://localhost/hook", /private/],
    ["https://10.0.0.5/hook", /private/],
    ["https://169.254.169.254/latest", /private/],
    ["https://[::1]/hook", /private/],
    ["https://metadata.google.internal/", /private/],
    ["https://user:pw@example.com/", /credentials/],
    ["not a url", /full URL/],
  ])("refuses %s", (url, why) => expect(urlProblem(url)).toMatch(why));

  it("accepts public https URLs", () => {
    expect(urlProblem("https://hooks.example-crm.com/inbound/everyops")).toBeNull();
  });

  it("knows private addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.20.0.1",
      "192.168.1.1",
      "100.64.0.1",
      "::ffff:10.0.0.1",
      "fd00::1",
      "fe80::1",
    ])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "34.120.0.1", "2606:4700::1111"])
      expect(isPrivateAddress(ip), ip).toBe(false);
  });
});
