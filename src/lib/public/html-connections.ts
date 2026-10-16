import type { Blueprint } from "@/lib/blueprint/types";
import { isPublic } from "./resolve";

/** Catch literal mistakes before offering AI code. This is not a JavaScript parser or a sandbox policy. */
export function htmlConnectionProblems(bp: Blueprint, pageId: string, html: string): string[] {
  const page = bp.views.find((v) => v.id === pageId);
  const problems = new Set<string>();
  const readable = (id: string) => {
    if (id === "page") return page?.type === "html" && !!page.live;
    const view = bp.views.find((v) => v.id === id);
    return (
      !!view &&
      (((view.type === "layout" || view.type === "landing") && isPublic(view)) ||
        (view.type === "table" && page?.type === "html" && (!page.public || !!view.publicData)))
    );
  };
  const need =
    page?.type === "html" && page.public
      ? "a published layout/landing source or a table shared as public data (update_view public:true on the table)"
      : "a table view or a published layout/landing source";
  const check = (method: string, id: string) => {
    const data = method === "data" || method === "items" || method === "record" || method === "watch";
    const view = bp.views.find((v) => v.id === id);
    const supported = data ? readable(id) : view?.type === "form" && view.public === true;
    if (!supported)
      problems.add(
        pageId +
          ": EveryOps." +
          method +
          '("' +
          id +
          '") needs ' +
          (data ? need : "a public form view") +
          ".",
      );
  };
  for (const match of html.matchAll(
    /EveryOps\.(data|items|record|watch|form|submit|slots|days|quote|upload)\s*\(\s*["'`]([^"'`]+)["'`]/g,
  )) {
    if (!match[2].includes("$" + "{")) check(match[1], match[2]);
  }
  for (const match of html.matchAll(/data-everyops-(?:form|embed)\s*=\s*["']([^"']+)["']/g))
    check("form", match[1]);
  for (const match of html.matchAll(/data-everyops-(each|record)\s*=\s*["']([^"']+)["']/g)) {
    const id = match[2];
    if (id.startsWith("@") || id === "site.pages" || id.includes("{")) continue;
    if (!readable(id))
      problems.add(
        pageId +
          ": data-everyops-" +
          match[1] +
          '="' +
          id +
          '" needs ' +
          (id === "page" ? "a website setup made (its own sections)" : need) +
          ".",
      );
  }
  for (const match of html.matchAll(/data-everyops-include\s*=\s*["']([^"']+)["']/g)) {
    const included = bp.views.find((v) => v.id === match[1]);
    if (included?.type !== "html" || included.id === pageId)
      problems.add(`${pageId}: data-everyops-include="${match[1]}" must name another html page.`);
  }
  return [...problems];
}
