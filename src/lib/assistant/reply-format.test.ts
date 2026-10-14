import { describe, expect, it } from "vitest";
import { replyBlocks, splitInlineLists } from "./reply-format";

describe("splitInlineLists", () => {
  it("moves inline numbered questions onto their own lines", () => {
    expect(
      splitInlineLists(
        "I'll assume 1-hour slots. To get started, I have 3 quick questions: 1. How many courts do you have? 2. What is your hourly rate? 3. What do you rent as add-ons?",
      ),
    ).toBe(
      "I'll assume 1-hour slots. To get started, I have 3 quick questions:\n\n1. How many courts do you have?\n2. What is your hourly rate?\n3. What do you rent as add-ons?",
    );
  });

  it("leaves numbers that are not an inline list alone", () => {
    const text = "Courts 1 and 2 are booked. Court 2. Then the rate is ₱1.50 per minute.";
    expect(splitInlineLists(text)).toBe(text);
    const listed = "Questions:\n1. Do you allow utang?\n2. Cash only?";
    expect(splitInlineLists(listed)).toBe(listed);
  });
});

describe("replyBlocks", () => {
  it("keeps spaced-out numbered questions in one list after the intro", () => {
    const blocks = replyBlocks(
      "Here's what I'd set up:\n- A booking page\n- A dashboard\n\nI'll assume 1-hour slots.\n\n1. How many courts?\n\n2. What is your rate?\n\n3. Any add-ons?",
    );
    expect(blocks.map(({ list, lines }) => ({ list, lines }))).toEqual([
      { list: undefined, lines: ["Here's what I'd set up:"] },
      { list: "ul", lines: ["A booking page", "A dashboard"] },
      { list: undefined, lines: ["I'll assume 1-hour slots."] },
      { list: "ol", lines: ["How many courts?", "What is your rate?", "Any add-ons?"] },
    ]);
  });
});
