import { describe, expect, it } from "vitest";
import { pickedNote, withoutPickedNote } from "./picked";
import { useScreen } from "./screen-store";

const big = "x".repeat(5000);
const pick = (n: number) => ({
  kind: "Custom page",
  label: `Card ${n}`,
  path: "Ride Cebu › Our fleet",
  text: big,
  html: `<div>${big}</div>`,
});

describe("picked note", () => {
  it("names each pick with where it sits, its text and markup", () => {
    const note = pickedNote([
      {
        kind: "Table row",
        label: "Ana Reyes",
        path: "Bookings › All bookings",
        text: "Ana Reyes Court 1 ₱400 Paid",
      },
    ]);
    expect(note).toBe(
      '(Picked on the page:\n1. Table row "Ana Reyes" in Bookings › All bookings\n   Text: Ana Reyes Court 1 ₱400 Paid)',
    );
  });

  it("fits three huge picks and a long message inside the route's 4,000 characters", () => {
    const typed = "y".repeat(3000);
    const note = pickedNote([pick(1), pick(2), pick(3)], Math.min(2400, 3900 - typed.length));
    expect(`${typed}\n${note}`.length).toBeLessThanOrEqual(4000);
    for (const n of [1, 2, 3]) expect(note).toContain(`Card ${n}`);
    expect(pickedNote([pick(1), pick(2), pick(3)]).length).toBeLessThanOrEqual(2400);
  });

  it("comes off again for History, leaving the person's words", () => {
    const sent = `Make this bigger\n${pickedNote([pick(1)])}`;
    expect(withoutPickedNote(sent)).toBe("Make this bigger");
    expect(withoutPickedNote("Keep (this) as is")).toBe("Keep (this) as is");
  });
});

describe("picked parts", () => {
  it("keeps one of each and at most three, newest last", () => {
    const s = useScreen.getState();
    s.clearPicked();
    for (const n of [1, 2, 2, 3, 4]) s.addPicked({ kind: "Card", label: `Card ${n}` });
    expect(useScreen.getState().picked.map((p) => p.label)).toEqual(["Card 2", "Card 3", "Card 4"]);
  });
});
