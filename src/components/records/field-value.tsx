"use client";

import { ArrowUpRightIcon, CheckIcon, FileIcon } from "@phosphor-icons/react";
import { useWorkspace } from "@/components/workspace/workspace-context";
import {
  fileName,
  isFilePath,
  isSignaturePath,
  normalizeUrl,
  telHref,
  urlLabel,
} from "@/lib/blueprint/contact";
import { displayKind } from "@/lib/blueprint/field-kind";
import { findEntity, findRecord, optionOf, recordTitle } from "@/lib/blueprint/lookup";
import type { Field, FieldValue as Value } from "@/lib/blueprint/types";
import {
  formatDate,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatNumber,
  formatPercent,
  formatRange,
  isTimeRange,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { PersonChip } from "./person-chip";
import { RatingStars } from "./rating-input";
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
    case "rating":
      return <RatingStars value={Number(value)} className={className} />;
    case "duration":
      return (
        <span className={cn("font-mono tabular text-[12.5px]", className)}>
          {formatDuration(Number(value))}
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
    case "email":
      return (
        <a
          href={`mailto:${String(value)}`}
          onClick={(e) => e.stopPropagation()}
          className={cn("truncate text-primary underline-offset-2 hover:underline", className)}
        >
          {String(value)}
        </a>
      );
    case "phone":
      return (
        <a
          href={telHref(String(value))}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "truncate whitespace-nowrap text-primary underline-offset-2 hover:underline",
            className,
          )}
        >
          {String(value)}
        </a>
      );
    case "url": {
      const href = normalizeUrl(String(value));
      return href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex max-w-full items-center gap-1 text-primary underline-offset-2 hover:underline",
            className,
          )}
        >
          <span className="truncate">{urlLabel(href)}</span>
          <ArrowUpRightIcon className="size-3 shrink-0" />
        </a>
      ) : (
        <span className={cn("truncate", className)}>{String(value)}</span>
      );
    }
    case "signature":
      return isSignaturePath(value, { preview: true }) ? (
        // biome-ignore lint/performance/noImgElement: a private upload served to the team, not an optimizable asset
        <img
          src={value}
          alt={`${field.name} (signed)`}
          className={cn("h-8 w-auto max-w-[140px] rounded-sm bg-white object-contain px-1", className)}
        />
      ) : (
        <Empty />
      );
    case "file":
      return isFilePath(value) ? (
        <a
          href={value}
          download={fileName(value)}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "inline-flex max-w-full items-center gap-1.5 rounded-md border bg-muted/40 px-1.5 py-0.5 text-[12.5px] hover:bg-muted",
            className,
          )}
        >
          <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{fileName(value)}</span>
        </a>
      ) : (
        <Empty />
      );
    case "image":
      return typeof value === "string" ? (
        // biome-ignore lint/performance/noImgElement: uploads are served by our own route at their own size
        <img
          src={value}
          alt={field.name}
          loading="lazy"
          className={cn("h-9 w-9 rounded-md border bg-white object-contain", className)}
        />
      ) : (
        <Empty />
      );
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
