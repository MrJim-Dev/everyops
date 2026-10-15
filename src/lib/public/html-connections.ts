import type { Blueprint } from "@/lib/blueprint/types";
import { isPublic } from "./resolve";

/** Catch literal mistakes before offering AI code. This is not a JavaScript parser or a sandbox policy. */
export function htmlConnectionProblems(bp: Blueprint, pageId: string, html: string): string[] {
  const page = bp.views.find((v) => v.id === pageId);
  const problems = new Set<string>();
  const check = (method: string, id: string) => {
    const view = bp.views.find((v) => v.id === id);
    const data = method === "data";
    const supported = data
      ? view &&
        (((view.type === "layout" || view.type === "landing") && isPublic(view)) ||
          (view.type === "table" && page?.type === "html" && !page.public))
      : view?.type === "form" && view.public;
    if (!supported)
      problems.add(
        `${pageId}: EveryOps.${method}("${id}") needs ${data ? "a published layout/landing source, or a table for private HTML" : "a public form view"}.`,
      );
  };
  for (const match of html.matchAll(
    /EveryOps\.(data|form|submit|slots|days|quote|upload)\s*\(\s*["'`]([^"'`]+)["'`]/g,
  )) {
    if (!match[2].includes("${")) check(match[1], match[2]);
  }
  for (const match of html.matchAll(/data-everyops-(?:form|embed)\s*=\s*["']([^"']+)["']/g))
    check("form", match[1]);
  return [...problems];
}
