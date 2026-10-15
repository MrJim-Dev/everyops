import { describe, expect, it } from "vitest";
import { applyMemoryEdits, MAX_NOTES, type MemoryNote, memoryContext, notesFromSetup } from "./memory";

const NOW = "2026-10-15T08:00:00.000Z";
let n = 0;
const ids = () => `mem_${++n}`;
const note = (text: string, extra: Partial<MemoryNote> = {}): MemoryNote => ({
  id: ids(),
  kind: "business",
  text,
  source: "assistant",
  createdAt: NOW,
  updatedAt: NOW,
  ...extra,
});

describe("notesFromSetup", () => {
  it("keeps the summary, the profile and the answered questions, and skips skipped ones", () => {
    const edits = notesFromSetup(
      {
        prompt: "We run 4 pickleball courts",
        progress: {
          profile: [
            { label: "Courts", value: "4 indoor courts" },
            { label: "Hours", value: "" },
          ],
          questions: [
            { question: "How do players pay?", answer: "GCash or cash at the desk" },
            { question: "Do you sell memberships?", answer: "Skip" },
          ],
        },
      },
      "Pickleball venue in Cebu",
    );
    expect(edits.map((e) => (e.action === "add" ? e.text : ""))).toEqual([
      "Pickleball venue in Cebu",
      "Courts: 4 indoor courts",
      "How do players pay: GCash or cash at the desk",
    ]);
  });

  it("falls back to the owner's own description when the interview left no profile", () => {
    const edits = notesFromSetup({ prompt: "A small bakery with two branches" }, "");
    expect(edits).toEqual([
      { action: "add", kind: "business", text: "In the owner's words: A small bakery with two branches" },
    ]);
  });
});

describe("applyMemoryEdits", () => {
  it("adds, updates and removes notes, skipping duplicates and unknown ids", () => {
    const hours = note("Open 6 AM to 10 PM");
    const old = note("Two branches");
    const result = applyMemoryEdits(
      [hours, old],
      [
        { action: "add", kind: "business", text: "open 6am to 10pm." },
        { action: "add", kind: "goal", text: "Opening a third branch in December" },
        { action: "update", id: hours.id, text: "Open 6 AM to 11 PM" },
        { action: "remove", id: old.id },
        { action: "remove", id: "mem_missing" },
      ],
      "assistant",
      NOW,
      ids,
    );
    expect(result.notes.map((x) => x.text)).toEqual([
      "Open 6 AM to 11 PM",
      "Opening a third branch in December",
    ]);
    expect(result.added).toHaveLength(1);
    expect(result.updated).toHaveLength(1);
    expect(result.removed.map((x) => x.text)).toEqual(["Two branches"]);
  });

  it("makes room by dropping the oldest notes from chat, never setup or the team's", () => {
    const setup = note("From setup", { source: "setup" });
    const chat = Array.from({ length: MAX_NOTES - 1 }, (_, i) => note(`Chat note ${i}`));
    const result = applyMemoryEdits(
      [setup, ...chat],
      [{ action: "add", kind: "business", text: "New" }],
      "owner",
      NOW,
      ids,
    );
    expect(result.notes).toHaveLength(MAX_NOTES);
    expect(result.notes[0].text).toBe("From setup");
    expect(result.removed.map((x) => x.text)).toEqual(["Chat note 0"]);
  });
});

describe("memoryContext", () => {
  it("leads with the business and ends with the owner's instructions", () => {
    const text = memoryContext(
      {
        instructions: "Call customers members.",
        notes: [note("Prefers short replies", { kind: "preference" }), note("Pickleball venue")],
        updatedAt: NOW,
      },
      "Courts and bookings",
    );
    expect(text.indexOf("Courts and bookings")).toBeLessThan(text.indexOf("Pickleball venue"));
    expect(text.indexOf("Prefers short replies")).toBeLessThan(text.indexOf("Call customers members."));
  });
});
