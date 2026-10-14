import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { blockPatchFrom, sectionWords } from "./assistant";

describe("website section edits", () => {
  it("reads a section's new words from labelled lines", () => {
    const hero = { id: "hero", type: "hero" as const, heading: "Old", ctaViewId: "book", ctaLabel: "Book" };
    expect(blockPatchFrom(hero, sectionWords("Title: Play tonight\nButton: Reserve now"))).toEqual({
      heading: "Play tonight",
      ctaLabel: "Reserve now",
    });
    const steps = { id: "steps", type: "steps" as const, items: [] };
    expect(
      blockPatchFrom(steps, sectionWords("Item: Pick a slot | Choose a court.\nItem: Pay | Send a deposit.")),
    ).toEqual({
      items: [
        { title: "Pick a slot", body: "Choose a court." },
        { title: "Pay", body: "Send a deposit." },
      ],
    });
    const contact = { id: "contact", type: "contact" as const };
    expect(blockPatchFrom(contact, sectionWords("Phone: 0917 555 0101\nHours: 6 AM to 11 PM"))).toEqual({
      phone: "0917 555 0101",
      hours: "6 AM to 11 PM",
    });
  });
});
