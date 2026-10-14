import { describe, expect, it } from "vitest";
import { courtBookingsSample } from "@/lib/catalog/court-bookings";
import { clockLabel, heroFacts } from "./hero-facts";
import { type ResolvedBlock, resolveBlocks } from "./resolve";
import { cleanIntro } from "./site-template";

const NOW = new Date("2026-10-14T03:00:00Z");

describe("hero intro", () => {
  // Court House PH's hero after a looped AI answer, Oct 14.
  it("keeps the whole sentences of a line that ran on", () => {
    const looped =
      "Book premium indoor and outdoor courts daily from 06:00 to 23:00. Fast online scheduling and instant confirmation details inside PHP 400 per hour slots duration standard booking formats available now directly web based booking systems format option list";
    expect(cleanIntro(looped)).toBe("Book premium indoor and outdoor courts daily from 06:00 to 23:00.");
  });

  it("leaves a short intro alone and cuts one long sentence at a word", () => {
    expect(cleanIntro("Book a court in a minute.")).toBe("Book a court in a minute.");
    const long = cleanIntro("word ".repeat(80), 40) ?? "";
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("word")).toBe(true);
  });
});

describe("hero facts", () => {
  it("reads opening hours the way people say them", () => {
    expect(clockLabel("06:00")).toBe("6 AM");
    expect(clockLabel("13:30")).toBe("1:30 PM");
    expect(clockLabel("23:00")).toBe("11 PM");
    expect(clockLabel("24:00")).toBe("midnight");
  });

  it("tells a visitor how many courts, the hours and the price per hour from the data", () => {
    const { blueprint, records } = courtBookingsSample(NOW);
    const facts = heroFacts(blueprint, records, NOW);
    expect(facts.find((f) => f.kind === "offer")?.text).toBe("4 courts");
    expect(facts.find((f) => f.kind === "hours")?.text).toBe("Open 6 AM to 11 PM");
    expect(facts.find((f) => f.kind === "price")?.text).toMatch(/^From ₱400(\.00)? an hour$/);
  });

  it("says nothing it can't back up", () => {
    const { blueprint } = courtBookingsSample(NOW);
    expect(heroFacts(blueprint, [], NOW).map((f) => f.kind)).toEqual(["hours", "price"]);
  });
});

describe("a landing page's hero as visitors get it", () => {
  const heroOf = (subheading: string) => {
    const { blueprint, records } = courtBookingsSample(NOW);
    const form = blueprint.views.find((v) => v.type === "form");
    if (form?.type === "form") form.public = true;
    const view = {
      id: "home",
      entityId: "",
      name: "Home",
      type: "landing" as const,
      blocks: [{ id: "hero", type: "hero" as const, heading: "Court House", subheading }],
    };
    blueprint.views.push(view);
    const [hero] = resolveBlocks(blueprint, records, {}, "court-house", view, NOW);
    return hero as Extract<ResolvedBlock, { type: "hero" }>;
  };

  it("leads to the booking form even when the page never set a button, named for what it does", () => {
    const hero = heroOf("Our own words.");
    expect(hero.ctaLabel).toBe("Book a court");
    expect(hero.ctaHref).toMatch(/^\/s\/court-house\//);
    expect(hero.subheading).toBe("Our own words.");
  });

  it("replaces the old default line and keeps words someone wrote", () => {
    const hero = heroOf("Send your request online and Court House will get back to you.");
    expect(hero.subheading).not.toMatch(/will get back to you/);
    expect(hero.subheading).toMatch(/^Pick a court and a time/);
  });
});
