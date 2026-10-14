import { describe, expect, it } from "vitest";
import { questionsMissing, withSystemNames } from "./setup-text";

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
