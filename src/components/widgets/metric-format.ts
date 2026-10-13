import { displayKind } from "@/lib/blueprint/field-kind";
import { getEntity } from "@/lib/blueprint/lookup";
import type { Blueprint, Widget } from "@/lib/blueprint/types";
import { formatMoney, formatNumber } from "@/lib/format";

/** Formats a widget's number using the kind of the field it measures. */
export function metricFormatter(bp: Blueprint, widget: Widget): (value: number) => string {
  const { op, fieldId } = widget.metric;
  if (op === "count" || !fieldId) return (v) => formatNumber(Math.round(v));
  const entity = getEntity(bp, widget.entityId);
  const field = entity.fields.find((f) => f.id === fieldId);
  const kind = field ? displayKind(bp, field) : "number";
  return kind === "money" ? (v) => formatMoney(Math.round(v)) : (v) => formatNumber(Math.round(v * 10) / 10);
}
