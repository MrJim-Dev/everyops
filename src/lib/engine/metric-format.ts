import { displayKind } from "@/lib/blueprint/field-kind";
import { getEntity } from "@/lib/blueprint/lookup";
import type { Blueprint, Widget } from "@/lib/blueprint/types";
import { formatMoney, formatNumber, formatPercent } from "@/lib/format";

const isMoney = (bp: Blueprint, entityId: string, fieldId: string | undefined) => {
  const field = bp.entities.find((e) => e.id === entityId)?.fields.find((f) => f.id === fieldId);
  return !!field && displayKind(bp, field) === "money";
};

/** Formats a widget's number using the kind of the field it measures. */
export function metricFormatter(bp: Blueprint, widget: Widget): (value: number) => string {
  if (widget.calc && widget.type !== "chart" && widget.type !== "list") {
    const format =
      widget.calc.format ??
      (widget.calc.terms.some((t) => t.op !== "count" && isMoney(bp, t.entityId, t.fieldId))
        ? "money"
        : "number");
    if (format === "money") return (v) => formatMoney(Math.round(v));
    if (format === "percent") return (v) => formatPercent(Math.round(v * 10) / 10);
    return (v) => formatNumber(Math.round(v * 10) / 10);
  }
  const { op, fieldId } = widget.metric;
  if (op === "count" || !fieldId) return (v) => formatNumber(Math.round(v));
  const entity = getEntity(bp, widget.entityId);
  const field = entity.fields.find((f) => f.id === fieldId);
  const kind = field ? displayKind(bp, field) : "number";
  return kind === "money" ? (v) => formatMoney(Math.round(v)) : (v) => formatNumber(Math.round(v * 10) / 10);
}
