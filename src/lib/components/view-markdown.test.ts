import { expect, it } from "vitest";
import { viewMarkdown } from "./view-markdown";

it("resolves generated shortcuts only through known workspace views", () => {
  const href = (id: string) => (id === "jobs_board" ? "/w/fixwell/jobs/jobs_board" : undefined);
  expect(viewMarkdown("[Jobs](view:jobs_board) and [Missing](view:unknown)", href)).toBe(
    "[Jobs](/w/fixwell/jobs/jobs_board) and Missing",
  );
});

it("leaves other URL schemes to the existing markdown sanitizer", () => {
  expect(viewMarkdown("[Bad](javascript:alert(1)) [Web](https://example.com)", () => undefined)).toBe(
    "[Bad](javascript:alert(1)) [Web](https://example.com)",
  );
});
