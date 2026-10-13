import { findEntity, findField, findRecord } from "@/lib/blueprint/lookup";
import type { Blueprint, DataRecord, Entity, RecordData } from "@/lib/blueprint/types";
import type { EvalContext, Value } from "./expr";

/**
 * Builds the evaluation context for one record. References resolve to the
 * record's own fields, or one relation hop away ("player.member").
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
      const [head, tail] = path;
      if (tail === undefined) return data[head];
      const field = findField(entity, head);
      if (field?.type !== "relation" || !field.relation) return undefined;
      const linkedId = data[head];
      if (typeof linkedId !== "string") return undefined;
      const linked = findRecord(records, linkedId);
      const linkedEntity = findEntity(bp, field.relation.entityId);
      if (!linked || !linkedEntity) return undefined;
      return linked.data[tail];
    },
  };
}
