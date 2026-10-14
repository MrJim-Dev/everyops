import { findEntity, findField, findRecord } from "@/lib/blueprint/lookup";
import type { Blueprint, DataRecord, Entity, RecordData } from "@/lib/blueprint/types";
import type { EvalContext, Value } from "./expr";

/**
 * Builds the evaluation context for one record. References resolve to the
 * record's own fields, or through links to other records ("player.member", "delivery.supplier.lead_days").
 */
export function recordContext(
  bp: Blueprint,
  entity: Entity,
  data: RecordData,
  records: DataRecord[],
  now: Date = new Date(),
): EvalContext {
  return {
    now,
    get(path): Value | undefined {
      let at = entity;
      let values = data;
      for (let i = 0; i < path.length; i++) {
        const part = path[i];
        if (i === path.length - 1) return values[part];
        const field = findField(at, part);
        // time.start and time.end read the two ends of a time range.
        const end = path[i + 1];
        if (field?.type === "time_range" && i === path.length - 2 && (end === "start" || end === "end")) {
          const range = values[part];
          return range && typeof range === "object" && !Array.isArray(range)
            ? (range as Record<string, Value>)[end]
            : undefined;
        }
        if (field?.type !== "relation" || !field.relation) return undefined;
        const linkedId = values[part];
        if (typeof linkedId !== "string") return undefined;
        const linked = findRecord(records, linkedId);
        const linkedEntity = findEntity(bp, field.relation.entityId);
        if (!linked || !linkedEntity) return undefined;
        at = linkedEntity;
        values = linked.data;
      }
      return undefined;
    },
  };
}
