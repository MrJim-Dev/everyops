import { describe, expect, it } from "vitest";
import { byUsage, usageBadges, usageText } from "./usage";

const now = new Date("2026-10-28T04:00:00.000Z");
const old = "2026-06-01T00:00:00.000Z";

describe("community usage", () => {
  it("ranks by workspaces in use, then by all uses", () => {
    const list = [
      { id: "copied-a-lot", uses: 40, active: 1, recent: 0 },
      { id: "in-use", uses: 9, active: 7, recent: 1 },
      { id: "same-use-more-copies", uses: 12, active: 7, recent: 0 },
    ];
    expect([...list].sort(byUsage).map((s) => s.id)).toEqual([
      "same-use-more-copies",
      "in-use",
      "copied-a-lot",
    ]);
  });

  it("marks the two most used, what's catching on, and what's new", () => {
    const badges = usageBadges(
      [
        { id: "court", uses: 20, active: 9, recent: 2, publishedAt: old },
        { id: "pos", uses: 8, active: 4, recent: 1, publishedAt: old },
        { id: "hris", uses: 6, active: 3, recent: 0, publishedAt: old },
        { id: "content", uses: 3, active: 1, recent: 3, publishedAt: old },
        { id: "fresh", uses: 0, active: 0, recent: 0, publishedAt: "2026-10-20T00:00:00.000Z" },
        { id: "quiet", uses: 0, active: 0, recent: 0, publishedAt: old },
        { id: "copied-not-used", uses: 30, active: 1, recent: 1, publishedAt: old },
      ],
      now,
    );
    expect(Object.fromEntries(badges)).toEqual({
      court: "popular",
      pos: "popular",
      content: "trending",
      fresh: "new",
    });
  });

  it("needs at least two workspaces in use to call anything most used", () => {
    expect(usageBadges([{ id: "one", uses: 5, active: 1, recent: 0, publishedAt: old }], now).size).toBe(0);
  });

  it("says plainly how a system is used", () => {
    expect(usageText({ uses: 12, active: 8, recent: 3 })).toBe(
      "Used by 12 workspaces, 8 active in the last 30 days, 3 new this month",
    );
    expect(usageText({ uses: 1, active: 0, recent: 0 })).toBe(
      "Used by 1 workspace, none active in the last 30 days",
    );
    expect(usageText({ uses: 0, active: 0, recent: 0 })).toBe("Not used yet");
  });
});
