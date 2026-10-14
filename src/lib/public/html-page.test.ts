import { describe, expect, it } from "vitest";
import type { Blueprint } from "@/lib/blueprint/types";
import { formSnippet, formValues, frameDocument, htmlDocKeys } from "./html-page";
import type { PublicForm } from "./resolve";

const booking: PublicForm = {
  viewId: "booking_form",
  title: "Book a court",
  submitLabel: "Book court",
  fields: [
    { id: "guest_name", name: "Your name", type: "text", required: true },
    { id: "court", name: "Court", type: "relation", required: true },
    { id: "time", name: "Time", type: "time_range", required: true },
    { id: "players", name: "Players", type: "number", required: false },
    {
      id: "level",
      name: "Level",
      type: "select",
      required: false,
      options: [
        { id: "beginner", label: "Beginner" },
        { id: "advanced", label: "Advanced" },
      ],
    },
    { id: "paddles", name: "Rent paddles", type: "checkbox", required: false },
  ],
  choices: { court: [{ id: "court_1", title: "Court 1" }] },
};

describe("formValues", () => {
  it("turns what a custom form sends into the booking form's fields", () => {
    expect(
      formValues(booking, {
        guest_name: " Ana Cruz ",
        court: "Court 1",
        time_start: "2026-10-20T18:00",
        time_end: "2026-10-20T19:00",
        players: "4",
        level: "Advanced",
        paddles: "on",
        is_admin: "true",
      }),
    ).toEqual({
      guest_name: "Ana Cruz",
      court: "court_1",
      // Manila wall-clock times become instants (UTC+8).
      time: { start: "2026-10-20T10:00:00.000Z", end: "2026-10-20T11:00:00.000Z" },
      players: 4,
      level: "advanced",
      paddles: true,
    });
  });

  it("drops choices the form doesn't offer", () => {
    expect(formValues(booking, { court: "Court 9", level: "Pro" })).toEqual({});
  });
});

describe("frameDocument", () => {
  it("adds the form bridge to a full page, before </body>", () => {
    const doc = frameDocument("<html><body><h1>Hi</h1></body></html>");
    expect(doc.indexOf("window.EveryOps")).toBeGreaterThan(doc.indexOf("<h1>"));
    expect(doc.indexOf("window.EveryOps")).toBeLessThan(doc.indexOf("</body>"));
  });

  it("wraps a fragment in a page that fits phones", () => {
    expect(frameDocument("<h1>Hi</h1>")).toMatch(
      /^<!doctype html>[\s\S]*width=device-width[\s\S]*<h1>Hi<\/h1>/,
    );
  });
});

describe("custom HTML in the workspace", () => {
  it("knows which docs hold HTML: pages and HTML blocks", () => {
    const bp = {
      views: [
        { id: "promo", type: "html", entityId: "", name: "Promo" },
        {
          id: "home",
          type: "landing",
          entityId: "",
          name: "Home",
          blocks: [{ id: "embed", type: "html", html: "" }],
        },
        { id: "policies", type: "document", entityId: "", name: "Policies" },
      ],
    } as unknown as Blueprint;
    expect(htmlDocKeys(bp)).toEqual(["promo", "home:embed"]);
  });

  it("writes a form whose inputs match the public form's fields", () => {
    const html = formSnippet(booking);
    expect(html).toContain('data-everyops-form="booking_form"');
    for (const name of ["guest_name", "court", "time_start", "time_end", "players", "level", "paddles"])
      expect(html).toContain(`name="${name}"`);
    expect(html).toContain('<option value="court_1">Court 1</option>');
  });
  +it("writes a stepped form as one fieldset per step, with Next and Back", () => {
    const html = formSnippet({
      ...booking,
      steps: [
        { title: "Court and time", fieldIds: ["court", "time"] },
        { title: "Your details", fieldIds: ["guest_name"] },
      ],
    });
    expect(html.match(/<fieldset data-step=/g)).toHaveLength(2);
    expect(html).toContain("<legend>Court and time</legend>");
    // Fields no step lists go on the last step.
    const last = html.slice(html.indexOf('data-step="2"'));
    for (const name of ["guest_name", "players", "level", "paddles"])
      expect(last).toContain(`name="${name}"`);
    expect(html).toContain("data-next");
    expect(html).toContain("<script>");
  });
});
