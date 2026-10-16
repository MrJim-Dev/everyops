import { z } from "zod";

/** Gemini's instructions and answer for matching spreadsheet columns to a record type's fields. */
export const IMPORT_MAP_SYSTEM = `You match the columns of a spreadsheet a small business owner is importing to the fields
of one record type in their EveryOps workspace. You get each field (id, name, type, choices) and each column (its index,
header and a few example values). For every column you are asked about, give the field id it fills, or "" when no
field fits. Judge by meaning and by the values, not only the header: "Contact" holding 0917 numbers is a phone field,
"Pax" is a number of guests, "OR #" is a receipt or reference number, "Amount Due" is money. Each field takes at most
one column. Never use a field that is already taken. Tagalog and Cebuano headers are common (Pangalan = name,
Presyo = price, Petsa = date).`;

export const importMapAnswer = z.object({
  columns: z.array(z.object({ index: z.number().int(), fieldId: z.string() })),
});
export type ImportMapAnswer = z.infer<typeof importMapAnswer>;

export type MapField = { id: string; name: string; type: string; options?: string[] };
export type MapColumn = { index: number; header: string; samples: string[] };

export function importMapPrompt(
  entityName: string,
  fields: MapField[],
  columns: MapColumn[],
  taken: string[],
) {
  return [
    `Record type: ${entityName}`,
    `Fields:\n${fields.map((f) => `- ${f.id} "${f.name}" (${f.type}${f.options?.length ? `: ${f.options.slice(0, 12).join(", ")}` : ""})`).join("\n")}`,
    taken.length ? `Already taken by other columns: ${taken.join(", ")}` : "",
    `Columns to match:\n${columns.map((c) => `- ${c.index}: "${c.header}" e.g. ${c.samples.map((s) => JSON.stringify(s.slice(0, 60))).join(", ")}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** Gemini's answer kept to fields that exist, aren't taken, and are used once. */
export function checkedMapping(
  answer: ImportMapAnswer,
  fields: MapField[],
  columns: MapColumn[],
  taken: string[],
) {
  const known = new Set(fields.map((f) => f.id));
  const used = new Set(taken);
  const asked = new Set(columns.map((c) => c.index));
  const out: Record<number, string> = {};
  for (const c of answer.columns) {
    if (!asked.has(c.index) || !known.has(c.fieldId) || used.has(c.fieldId)) continue;
    out[c.index] = c.fieldId;
    used.add(c.fieldId);
  }
  return out;
}
