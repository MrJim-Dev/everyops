import type { Blueprint, Entity, Field, LayoutView } from "@/lib/blueprint/types";
import { type ComponentDef, componentDef, layoutItems, type Ref } from "./registry";

/**
 * What a public layout page may show a visitor. Numbers and charts are worked out on the server and only their
 * results are sent; lists and tables send only the fields they name. Nothing that identifies or reaches a person
 * (customers, players, guests, staff: their names, phones, emails, addresses) is ever listed or used as a chart label.
 */

/** Components that show the team's own screens or people as they are; they never go on a public page. */
export const TEAM_ONLY = new Set(["avatars", "view", "widget"]);
/**
 * Components that list records, so every field they show is checked. The calendar isn't one: on a public page it
 * sends a count per day and nothing about the records.
 */
const LISTS = new Set(["table", "data_table", "list", "carousel", "accordion"]);

const PEOPLE =
  /customer|client|guest|player|member|employee|staff|tenant|patient|student|person|people|user|contact|lead|applicant|donor|parent|renter|borrower|attendee|driver|cashier|agent/i;
const CONTACT =
  /phone|mobile|cell|e-?mail|contact|address|birth|\bsss\b|\btin\b|philhealth|pag-?ibig|salary|id.?number/i;

const words = (x: { id: string; name: string }) => `${x.id.replace(/_/g, " ")} ${x.name}`;

/** A record type about people: named like customers or staff, or holding phone numbers and emails. */
export function aboutPeople(entity: Entity): boolean {
  return (
    PEOPLE.test(words(entity)) ||
    PEOPLE.test(entity.pluralName) ||
    entity.fields.some((f) => (f.type === "text" || f.type === "long_text") && CONTACT.test(words(f)))
  );
}

/** A field that names or reaches a person: a person field, contact details, a person's name, or a link to people. */
export function personalField(bp: Blueprint, field: Field): boolean {
  if (field.type === "person" || CONTACT.test(words(field)) || PEOPLE.test(words(field))) return true;
  if (field.type === "relation") {
    const target = bp.entities.find((e) => e.id === field.relation?.entityId);
    return !!target && aboutPeople(target);
  }
  return false;
}

/** Why a component can't be on a public page, or nothing when it can. */
export function publicProblems(bp: Blueprint, d: ComponentDef, props: Record<string, unknown>): string[] {
  if (TEAM_ONLY.has(d.id))
    return [`${d.name} shows the team's own screens or people and can't be on a public page`];
  const problems: string[] = [];
  const refs = d.refs(props);
  const entities = new Set(refs.flatMap((r) => (r.kind === "entity" ? [r.entityId] : [])));
  for (const id of entities) {
    const entity = bp.entities.find((e) => e.id === id);
    if (!entity) continue;
    if (LISTS.has(d.id) && aboutPeople(entity))
      problems.push(
        `${d.name} lists ${entity.pluralName}, which are about people; a public page can't list them`,
      );
    // A list leads with each record's name, so that counts as a field it shows.
    const title = entity.fields.find((f) => f.id === entity.primaryFieldId);
    if (
      (d.id === "list" || d.id === "carousel" || (d.id === "accordion" && !props.titleFieldId)) &&
      title &&
      personalField(bp, title)
    )
      problems.push(`${d.name} would show ${entity.name} names (${title.name}), which identify people`);
  }
  for (const r of refs as Ref[]) {
    if (r.kind !== "field") continue;
    const entity = bp.entities.find((e) => e.id === r.entityId);
    const field = entity?.fields.find((f) => f.id === r.fieldId);
    if (!field || r.needs === "number" || r.needs === "date") continue;
    if (personalField(bp, field))
      problems.push(
        `${d.name} uses ${field.name}, which names or reaches a person; leave it off a public page`,
      );
  }
  if (d.id === "button" || d.id === "form") {
    const view = bp.views.find((v) => v.id === props.viewId);
    const open =
      !!view &&
      ((view.type === "landing" && view.public !== false) ||
        ((view.type === "form" || view.type === "html" || view.type === "layout") && view.public === true));
    if (!open) problems.push(`${d.name} opens "${String(props.viewId)}", which isn't a public page`);
  }
  return problems;
}

/** Every reason a layout page can't be public yet, one line per part. */
export function layoutPublicProblems(bp: Blueprint, view: LayoutView): string[] {
  return layoutItems(view.sections).flatMap(({ item }) => {
    const d = componentDef(item.component);
    if (!d) return [];
    const parsed = d.props.safeParse(item.props);
    return parsed.success ? publicProblems(bp, d, parsed.data) : [];
  });
}
