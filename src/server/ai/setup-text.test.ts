import { describe, expect, it } from "vitest";
import type { SetupQuestion } from "@/lib/store/workspace-model";
import {
  askAgainMessage,
  askList,
  erpChecklist,
  keepPartsFirst,
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

describe("an ERP's checklist", () => {
  const q = (id: string, question: string, options: string[] = [], answer = ""): SetupQuestion => ({
    id,
    question,
    required: true,
    answer,
    options,
  });
  const ids = (list: SetupQuestion[]) => list.map((x) => x.id);

  it("asks what the business does first, alone and with nothing recommended, when the owner didn't say", () => {
    // What Gemini asked for "I need an ERP.", Trading recommended.
    const asked = [
      q("business_type", "What type of business do you run?", ["Trading or wholesale", "Manufacturing", "Services"]),
      q("business_name", "What is the name of your business?", ["Pick a name for me"]),
      q("core_ops", "Which key operations do you need to manage most urgently?", ["Sales and inventory"]),
    ];
    const { questions, kindFirst } = erpChecklist(asked);
    expect(kindFirst).toBe("business_type");
    const cards = askList(questions, [kindFirst ?? ""]).filter((x) => x.id === kindFirst);
    expect(cards).toEqual([expect.objectContaining({ id: "business_type", neutral: true })]);
    // The rest of the ERP's questions wait on the checklist.
    expect(ids(questions)).toEqual(expect.arrayContaining(["erp_stock", "erp_purchasing", "erp_production"]));
  });

  it("adds the question itself when Gemini didn't ask it", () => {
    const { questions, kindFirst } = erpChecklist([q("business_name", "What is the name of your business?")]);
    expect(kindFirst).toBe("erp_kind");
    expect(questions.find((x) => x.id === "erp_kind")).toMatchObject({ required: true, neutral: true });
  });

  it("doesn't ask a described business what it does, and keeps a maker's stock and production in", () => {
    const asked = [
      q("stock", "Do you want to track raw materials like flour and sugar?", [
        "Finished goods only",
        "Raw materials and finished goods",
      ]),
      q("suppliers", "Who supplies your flour and do you send purchase orders?", ["Yes, with purchase orders"]),
    ];
    const { questions, kindFirst } = erpChecklist(
      asked,
      "I need an ERP for my small bakery. Restaurants, caf�s, food stalls, canteens, bakeries and catering",
    );
    expect(kindFirst).toBeUndefined();
    expect(ids(questions)).not.toContain("erp_kind");
    // Gemini's own questions count; only what it didn't ask is added.
    expect(ids(questions)).toEqual(["stock", "suppliers", "erp_production", "erp_payment_terms", "erp_locations"]);
    expect(questions[0].options?.[0]).toBe("Raw materials and finished goods");
    expect(questions.find((x) => x.id === "erp_production")?.options?.[0]).toMatch(/^Yes/);
  });

  it("doesn't ask a trader to make anything", () => {
    const { questions } = erpChecklist([
      q("erp_kind", "What does the business mainly do?", [], "Buy and resell products"),
    ]);
    expect(questions.find((x) => x.id === "erp_production")).toMatchObject({ required: false });
    expect(openRequired(questions).map((x) => x.id)).not.toContain("erp_production");
    expect(questions.find((x) => x.id === "erp_stock")?.neutral).toBe(true);
  });

  it("puts an answer that keeps the part first", () => {
    expect(keepPartsFirst(["Finished goods only", "Both", "Raw only"])).toEqual(["Both", "Finished goods only", "Raw only"]);
    expect(keepPartsFirst(["Yes, with purchase orders", "No"])).toEqual(["Yes, with purchase orders", "No"]);
  });
});

