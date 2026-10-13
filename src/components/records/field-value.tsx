"use client";

import { CheckIcon } from "@phosphor-icons/react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { displayKind } from "@/lib/blueprint/field-kind";
import { findEntity, findRecord, optionOf, recordTitle } from "@/lib/blueprint/lookup";
import type { Field, FieldValue as Value } from "@/lib/blueprint/types";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRange,
  isTimeRange,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { PersonChip } from "./person-chip";
import { StatusBadge } from "./status-badge";

const Empty = () => <span className="text-muted-foreground/50">—</span>;

/** Renders any field's value the same way everywhere: tables, cards, panels, widgets. */
export function FieldValue({
  field,
  value,
  className,
}: {
  field: Field;
  value: Value | undefined;
  className?: string;
}) {
  const { blueprint, records } = useWorkspace();
  const kind = displayKind(blueprint, field);
  if (value === undefined || value === null || value === "") return <Empty />;

  switch (kind) {
    case "money":
      return (
        <span className={cn("font-mono tabular text-[12.5px]", className)}>{formatMoney(Number(value))}</span>
      );
    case "number":
      return (
        <span className={cn("font-mono tabular text-[12.5px]", className)}>
          {formatNumber(Number(value))}
        </span>
      );
    case "percent":
      return (
        <span className={cn("font-mono tabular text-[12.5px]", className)}>
          {formatPercent(Number(value))}
        </span>
      );
    case "checkbox":
      return value ? <CheckIcon aria-label="Yes" className="size-4 text-foreground" /> : <Empty />;
    case "date":
      return <span className={className}>{typeof value === "string" ? formatDate(value) : <Empty />}</span>;
    case "datetime":
      return (
        <span className={className}>{typeof value === "string" ? formatDateTime(value) : <Empty />}</span>
      );
    case "time_range": {
      if (!isTimeRange(value)) return <Empty />;
      return (
        <span className={cn("whitespace-nowrap", className)}>
          {field.range === "dates" ? (
            formatRange(value)
          ) : (
            <>
              <span className="text-muted-foreground">{formatDate(value.start)} · </span>
              {formatRange(value)}
            </>
          )}
        </span>
      );
    }
    case "status": {
      const option = optionOf(field, value);
      return option ? (
        <StatusBadge label={option.label} tone={option.tone} className={className} />
      ) : (
        <Empty />
      );
    }
    case "choice":
      return <span className={className}>{optionOf(field, value)?.label ?? String(value)}</span>;
    case "multi":
      return (
        <span className={className}>
          {(Array.isArray(value) ? value : []).map((v) => optionOf(field, v)?.label ?? v).join(", ")}
        </span>
      );
    case "person":
      return <PersonChip name={String(value)} />;
    case "relation": {
      const target = field.relation ? findEntity(blueprint, field.relation.entityId) : undefined;
      const linked = typeof value === "string" ? findRecord(records, value) : undefined;
      return target && linked ? (
        <span className={cn("truncate", className)}>{recordTitle(target, linked)}</span>
      ) : (
        <Empty />
      );
    }
    default:
      return <span className={cn("truncate", className)}>{String(value)}</span>;
  }
}
