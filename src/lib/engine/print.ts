import { displayKind, isNumericKind } from "@/lib/blueprint/field-kind";
import { walkPath } from "@/lib/blueprint/paths";
import type {
  Blueprint,
  DataRecord,
  Entity,
  Field,
  FieldValue,
  PaperSize,
  PrintTemplate,
} from "@/lib/blueprint/types";
import { formatDate } from "@/lib/format";
import { todayKey } from "@/lib/time";
import { readable } from "./automations";
import { recordContext } from "./context";

/**
 * Print templates: an invoice, quote or agreement for one record, as markdown with {{placeholders}} filled from
 * the record, the records it links to and its line items. The browser prints the result (or saves it as a PDF),
 * so nothing is generated on the server.
 */

export const PAPER_SIZES: { id: PaperSize; label: string }[] = [
  { id: "a4", label: "A4" },
  { id: "letter", label: "Letter" },
  { id: "receipt", label: "Receipt (80 mm)" },
];

const TOKEN = /\{\{\s*([\w.:]+)\s*\}\}/g;
const SPECIAL = new Set(["business", "today", "lines"]);
/** Fields that don't read as a cell or a line: uploads (pictures are allowed on their own) and long notes. */
const HIDDEN = new Set(["file"]);

export const templatesFor = (bp: Blueprint, entityId: string) =>
  (bp.printTemplates ?? []).filter((t) => t.entityId === entityId);

/** Record types whose records are this one's line items (order lines of an order). */
export const lineEntities = (bp: Blueprint, entity: Entity) =>
  bp.entities.filter((e) => e.parent?.entityId === entity.id && e.id !== entity.id);

/** A value's characters that markdown would read as formatting, escaped so data can't change the layout. */
export function escapeMarkdown(text: string): string {
  return text
    .replace(/[\\`*_[\]<>|~#]/g, (c) => `\\${c}`)
    .replace(/^(\s*)([-+])(\s)/gm, (_, a: string, b: string, c: string) => `${a}\\${b}${c}`)
    .replace(/^(\s*)(\d+)\.(\s)/gm, (_, a: string, n: string, c: string) => `${a + n}\\.${c}`)
    .replace(/\r?\n/g, "  \n");
}

function valueText(bp: Blueprint, field: Field | undefined, value: FieldValue, records: DataRecord[]) {
  if (value === undefined || value === null || value === "") return "";
  if (field?.type === "image" && typeof value === "string")
    return value.startsWith("/") ? `![${escapeMarkdown(field.name)}](${encodeURI(value)})` : "";
  if (field && HIDDEN.has(field.type)) return "";
  return escapeMarkdown(readable(bp, field, value, records));
}

/** The columns a line-item table shows: the item first, then what the lines fill in, up to six. */
function lineColumns(child: Entity, lines: DataRecord[]): Field[] {
  const parentField = child.parent?.fieldId ?? "";
  const filled = (id: string) =>
    lines.some((l) => l.data[id] !== undefined && l.data[id] !== null && l.data[id] !== "");
  // A link a formula already shows (Item reads product.name) would only repeat it.
  const mirrored = (id: string) =>
    child.fields.some((o) => filled(o.id) && !!o.formula?.expr.trim().startsWith(`${id}.`));
  return child.fields
    .filter(
      (f) =>
        f.id !== parentField &&
        !HIDDEN.has(f.type) &&
        f.type !== "image" &&
        f.type !== "long_text" &&
        filled(f.id) &&
        !(f.type === "relation" && mirrored(f.id)),
    )
    .sort((a, b) => Number(b.id === child.primaryFieldId) - Number(a.id === child.primaryFieldId))
    .slice(0, 6);
}

function linesTable(bp: Blueprint, child: Entity, record: DataRecord, records: DataRecord[]): string {
  const parentField = child.parent?.fieldId ?? "";
  const lines = records.filter((r) => r.entityId === child.id && r.data[parentField] === record.id);
  if (!lines.length) return "";
  const cols = lineColumns(child, lines);
  if (!cols.length) return "";
  const cell = (s: string) => s.replace(/ {2}\n/g, " ") || " ";
  const head = `| ${cols.map((c) => escapeMarkdown(c.name)).join(" | ")} |`;
  const align = `|${cols.map((c) => (isNumericKind(displayKind(bp, c)) ? " ---: " : " --- ")).join("|")}|`;
  const rows = lines.map(
    (l) => `| ${cols.map((c) => cell(valueText(bp, c, l.data[c.id], records))).join(" | ")} |`,
  );
  return [head, align, ...rows].join("\n");
}

/** What {{lines}} or {{lines:child}} becomes: one table per kind of line item, or nothing when there are none. */
function linesText(bp: Blueprint, entity: Entity, record: DataRecord, records: DataRecord[], only?: string) {
  return lineEntities(bp, entity)
    .filter((c) => !only || c.id === only)
    .map((c) => linesTable(bp, c, record, records))
    .filter(Boolean)
    .join("\n\n");
}

/** The template filled in for one record, as markdown. Placeholders that don't resolve become blank. */
export function renderPrint(
  bp: Blueprint,
  template: Pick<PrintTemplate, "body">,
  record: DataRecord,
  records: DataRecord[],
  now: Date = new Date(),
): string {
  const entity = bp.entities.find((e) => e.id === record.entityId);
  if (!entity) return "";
  const ctx = recordContext(bp, entity, record.data, records, now);
  return template.body.replace(TOKEN, (_, token: string) => {
    if (token === "business") return escapeMarkdown(bp.workspaceName);
    if (token === "today") return escapeMarkdown(formatDate(todayKey(now), { withYear: true }));
    if (token === "lines" || token.startsWith("lines:"))
      return linesText(bp, entity, record, records, token.slice(6) || undefined);
    const parts = token.split(".");
    const { steps, error } = walkPath(bp, entity, parts);
    if (error) return "";
    const value = ctx.get(parts) as FieldValue | undefined;
    return valueText(bp, steps[steps.length - 1]?.field, value ?? null, records);
  });
}

/** Placeholders in a template that don't match anything, so the editor can point them out. */
export function unknownPlaceholders(bp: Blueprint, entity: Entity, body: string): string[] {
  const children = new Set(lineEntities(bp, entity).map((c) => c.id));
  const bad = new Set<string>();
  for (const [, token] of body.matchAll(TOKEN)) {
    if (SPECIAL.has(token)) continue;
    if (token.startsWith("lines:")) {
      if (!children.has(token.slice(6))) bad.add(token);
      continue;
    }
    if (walkPath(bp, entity, token.split(".")).error) bad.add(token);
  }
  return [...bad];
}

export type PlaceholderOption = { token: string; label: string; group: string };

/** What the editor offers to insert: the record's fields, the fields of records it links to, and the extras. */
export function placeholderOptions(bp: Blueprint, entity: Entity): PlaceholderOption[] {
  const out: PlaceholderOption[] = [
    { token: "{{business}}", label: "Business name", group: "General" },
    { token: "{{today}}", label: "Today's date", group: "General" },
  ];
  for (const c of lineEntities(bp, entity))
    out.push({ token: `{{lines:${c.id}}}`, label: `${c.pluralName} table`, group: "General" });
  for (const f of entity.fields)
    if (!HIDDEN.has(f.type)) out.push({ token: `{{${f.id}}}`, label: f.name, group: entity.name });
  for (const link of entity.fields.filter((f) => f.type === "relation" && f.id !== entity.parent?.fieldId)) {
    const target = bp.entities.find((e) => e.id === link.relation?.entityId);
    if (!target) continue;
    for (const f of target.fields.filter((x) => x.id !== target.primaryFieldId && !HIDDEN.has(x.type)))
      out.push({ token: `{{${link.id}.${f.id}}}`, label: f.name, group: link.name });
  }
  return out;
}

/**
 * A ready-to-edit template for a record type: the business and title, every detail as a line, its line items,
 * and its notes at the end. Owners start from this and change the words.
 */
export function starterTemplate(bp: Blueprint, entity: Entity, name = entity.name): string {
  const detail = entity.fields.filter(
    (f) =>
      f.id !== entity.primaryFieldId &&
      f.id !== entity.parent?.fieldId &&
      !HIDDEN.has(f.type) &&
      f.type !== "long_text" &&
      f.type !== "image",
  );
  const notes = entity.fields.filter((f) => f.type === "long_text");
  const pictures = entity.fields.filter((f) => f.type === "image");
  const parts = ["# {{business}}", `## ${name} {{${entity.primaryFieldId}}}`];
  if (detail.length) parts.push(detail.map((f) => `**${f.name}:** {{${f.id}}}`).join("  \n"));
  if (lineEntities(bp, entity).length) parts.push("{{lines}}");
  for (const f of notes) parts.push(`### ${f.name}\n\n{{${f.id}}}`);
  for (const f of pictures) parts.push(`{{${f.id}}}`);
  parts.push("---\n\n{{business}} · Printed {{today}}");
  return `${parts.join("\n\n")}\n`;
}
