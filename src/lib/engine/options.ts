import type { Blueprint, DataRecord } from "@/lib/blueprint/types";

/** How many records use each option of each choice field, keyed "entityId.fieldId" then option id. */
export type OptionUsage = Record<string, Record<string, number>>;

const CHOICE = new Set(["select", "multi_select", "status"]);

export function optionUsage(bp: Blueprint, records: DataRecord[]): OptionUsage {
  const usage: OptionUsage = {};
  for (const entity of bp.entities)
    for (const field of entity.fields) {
      if (!CHOICE.has(field.type)) continue;
      const counts: Record<string, number> = {};
      for (const r of records) {
        if (r.entityId !== entity.id) continue;
        const value = r.data[field.id];
        for (const id of Array.isArray(value) ? value : [value])
          if (typeof id === "string" && id) counts[id] = (counts[id] ?? 0) + 1;
      }
      if (Object.keys(counts).length) usage[`${entity.id}.${field.id}`] = counts;
    }
  return usage;
}

/**
 * Problems a change would cause by dropping options that records still use: those records would hold a value
 * the field no longer offers. Renaming an option's label is fine; its id stays. Written for the model to repair.
 */
export function strandedOptions(before: Blueprint, after: Blueprint, usage: OptionUsage): string[] {
  const problems: string[] = [];
  for (const entity of before.entities) {
    const nextEntity = after.entities.find((e) => e.id === entity.id);
    for (const field of entity.fields) {
      if (!CHOICE.has(field.type) || !field.options?.length) continue;
      const nextField = nextEntity?.fields.find((f) => f.id === field.id);
      if (!nextField) continue;
      const kept = new Set((nextField.options ?? []).map((o) => o.id));
      const used = usage[`${entity.id}.${field.id}`] ?? {};
      for (const option of field.options) {
        const count = used[option.id] ?? 0;
        if (kept.has(option.id) || !count) continue;
        problems.push(
          `${entity.name} › ${field.name}: removing option "${option.label}" (id "${option.id}") would leave ${count} ` +
            `${count === 1 ? entity.name.toLowerCase() : entity.pluralName.toLowerCase()} with a value the field no longer offers. ` +
            `Keep that option id in the options (you may change its label), or move those records to another option first.`,
        );
      }
    }
  }
  return problems;
}
