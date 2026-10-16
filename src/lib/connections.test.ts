import { describe, expect, it } from "vitest";
import { canPropose, canRead, geminiSchema, splitToolName, toolName } from "./connections";

describe("outside tool names", () => {
  it("round-trips provider and tool", () => {
    expect(toolName("google_calendar", "list_events")).toBe("calendar__list_events");
    expect(splitToolName("calendar__list_events")).toEqual({
      provider: "google_calendar",
      tool: "list_events",
    });
    expect(splitToolName("search_records")).toBeNull();
    expect(splitToolName("dropbox__list")).toBeNull();
  });

  it("only allows vetted tools: reads to call, writes to propose", () => {
    expect(canRead("google_calendar", "list_events")).toBe(true);
    expect(canRead("google_calendar", "create_event")).toBe(false);
    expect(canPropose("google_calendar", "create_event")).toBe(true);
    expect(canPropose("google_calendar", "list_events")).toBe(false);
    expect(canRead("gmail", "send_message")).toBe(false);
    expect(canPropose("gmail", "send_message")).toBe(false);
  });
});

describe("geminiSchema", () => {
  it("keeps what Gemini accepts and drops the rest", () => {
    const out = geminiSchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {
        calendarId: { type: "string", description: "Calendar" },
        timeMin: { type: ["string", "null"], format: "date-time" },
        attendees: {
          type: "array",
          items: { type: "object", properties: { email: { type: "string" } }, $ref: "#/x" },
        },
      },
      required: ["calendarId"],
    });
    expect(out).toEqual({
      type: "object",
      properties: {
        calendarId: { type: "string", description: "Calendar" },
        timeMin: { type: "string", nullable: true, format: "date-time" },
        attendees: { type: "array", items: { type: "object", properties: { email: { type: "string" } } } },
      },
      required: ["calendarId"],
    });
  });
});
