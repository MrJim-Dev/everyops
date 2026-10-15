import { describe, expect, it } from "vitest";
import {
  askAgainMessage,
  askList,
  mergeQuestions,
  openRequired,
  questionsMissing,
  withSystemNames,
} from "./setup-text";

describe("setup reply text", () => {
  it("names community systems instead of showing their ids", () => {
    expect(
      withSystemNames("A dashboard, built on our canteen-pos system.", [
        { id: "canteen-pos", name: "Canteen POS" },
      ]),
    ).toBe("A dashboard, built on our Canteen POS system.");
  });

  it("spots a reply that announces questions without asking them", () => {
    expect(questionsMissing("To tailor this for you, I have 3 quick questions:")).toBe(true);
    expect(questionsMissing("Questions:\n1. Do you allow utang?")).toBe(false);
  });
});

describe("setup checklist", () => {
  const courts = { id: "court_count", question: "How many courts do you have?", required: true, answer: "" };
  const rate = { id: "rate", question: "What do you charge per hour?", required: true, answer: "₱400" };
  const promo0 = () => ({ id: "promo", question: "Any promos?", required: false, answer: "" });
  const promo = promo0();

  it("keeps questions Gemini dropped and answers it blanked", () => {
    const merged = mergeQuestions([courts, rate], [{ ...rate, answer: "" }, promo]);
    expect(merged.map((q) => q.id)).toEqual(["rate", "promo", "court_count"]);
    expect(merged.find((q) => q.id === "rate")?.answer).toBe("₱400");
  });

  it("keeps an unanswered required question required", () => {
    const merged = mergeQuestions([courts], [{ ...courts, required: false }]);
    expect(openRequired(merged).map((q) => q.id)).toEqual(["court_count"]);
  });

  it("closes a required question once answered", () => {
    const merged = mergeQuestions([courts], [{ ...courts, required: false, answer: "6 courts" }]);
    expect(openRequired(merged)).toEqual([]);
  });

  it("puts the asked questions on cards, required first, plus required ones it moved on from", () => {
    const options = { options: ["₱400 flat all day", "₱350 off-peak / ₱500 peak"] };
    const name = {
      id: "name",
      question: "What's the venue called?",
      required: true,
      answer: "Dink District",
    };
    const promo = { ...promo0(), ...options };
    const cards = askList([name, { ...courts, ...options }, promo, rate], ["promo"]);
    expect(cards.map((q) => q.id)).toEqual(["court_count", "promo"]);
    expect(cards[0]).toEqual({
      id: "court_count",
      question: courts.question,
      required: true,
      options: options.options,
    });
  });

  it("says the questions are below when it holds a design back", () => {
    expect(askAgainMessage([courts])).toMatch(/one answer.*It's below\.$/);
  });
});
