import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("./usage", () => ({ recordAiCall: vi.fn(), countTokens: vi.fn() }));

import { fillRequired, runawayWatcher, strictSchema } from "./claude";

describe("the schema sent to Claude's structured output", () => {
  it("closes every object and drops the size and pattern rules, but not fields with those names", () => {
    const out = strictSchema({
      type: "object",
      properties: {
        name: { type: "string", maxLength: 40, pattern: "^[a-z]+$" },
        format: { type: "string", enum: ["a4", "letter"] },
        rows: { type: "array", minItems: 1, maxItems: 12, items: { type: "object", properties: {} } },
      },
      required: ["name"],
    });
    expect(out).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        format: { type: "string", enum: ["a4", "letter"] },
        rows: { type: "array", items: { type: "object", properties: {}, additionalProperties: false } },
      },
      required: ["name"],
      additionalProperties: false,
    });
  });
});

describe("an answer written without structured output", () => {
  const schema = {
    type: "object",
    required: ["kind", "reply", "sources", "plan"],
    properties: {
      kind: { type: "string", enum: ["answer", "plan"] },
      reply: { type: "string" },
      sources: { type: "array", items: { type: "string" } },
      plan: {
        type: "object",
        required: ["title", "ops"],
        properties: { title: { type: "string" }, ops: { type: "array", items: { type: "object" } } },
      },
    },
  };

  it("gets back the empty plan and lists Claude left out of a plain answer", () => {
    expect(fillRequired({ kind: "answer", reply: "Hi" }, schema)).toEqual({
      kind: "answer",
      reply: "Hi",
      sources: [],
      plan: { title: "", ops: [] },
    });
  });

  it("is never given a choice Claude didn't make", () => {
    expect(fillRequired({ reply: "Hi" }, schema)).not.toHaveProperty("kind");
  });
});

describe("an answer that trails off", () => {
  it("is stopped when it turns into blank space, and not for ordinary indentation", () => {
    const watch = runawayWatcher();
    expect(watch(`{\n  "n": 1,\n${" ".repeat(40)}"m": 2`)).toBeNull();
    expect(watch("\n".repeat(500))).toBe("blank space that never ends");
  });
});
