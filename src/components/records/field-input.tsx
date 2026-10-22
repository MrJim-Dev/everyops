"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { normalizeUrl } from "@/lib/blueprint/contact";
import type { Field, FieldValue, TimeRange } from "@/lib/blueprint/types";
import { isTimeRange } from "@/lib/format";
import { at, dateKey, manilaParts } from "@/lib/time";
import { DurationInput } from "./duration-input";
import { FileInput } from "./file-input";
import { ImageInput } from "./image-input";
import { RatingInput } from "./rating-input";
import { RelationInput } from "./relation-input";
import { SignatureInput } from "./signature-input";

const pad = (n: number) => String(n).padStart(2, "0");
const timeOf = (iso: string) => {
  const p = manilaParts(iso);
  return `${pad(p.hour)}:${pad(p.minute)}`;
};
const localDateTime = (iso: string) => `${dateKey(iso)}T${timeOf(iso)}`;

type Props = {
  id: string;
  field: Field;
  value: FieldValue | undefined;
  onChange: (value: FieldValue) => void;
  invalid?: boolean;
};

/** One input for every field type, so every form in EveryOps behaves the same. */
export function FieldInput({ id, field, value, onChange, invalid }: Props) {
  const common = { id, "aria-invalid": invalid || undefined, "aria-required": field.required || undefined };

  switch (field.type) {
    case "long_text":
      return (
        <Textarea
          {...common}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
        />
      );
    case "number":
    case "percent":
      return (
        <Input
          {...common}
          type="number"
          inputMode="decimal"
          value={value === null || value === undefined ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        />
      );
    case "rating":
      return (
        <RatingInput
          id={id}
          label={field.name}
          invalid={invalid}
          value={typeof value === "number" ? value : null}
          onChange={onChange}
        />
      );
    case "duration":
      return (
        <DurationInput
          {...common}
          value={typeof value === "number" || typeof value === "string" ? value : null}
          onChange={onChange}
        />
      );
    case "money":
      return (
        <InputGroup>
          <InputGroupAddon>
            <InputGroupText>₱</InputGroupText>
          </InputGroupAddon>
          <InputGroupInput
            {...common}
            type="number"
            inputMode="decimal"
            value={value === null || value === undefined ? "" : String(value)}
            onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
          />
        </InputGroup>
      );
    case "date":
      return (
        <Input
          {...common}
          type="date"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value || null)}
        />
      );
    case "datetime":
      return (
        <Input
          {...common}
          type="datetime-local"
          value={typeof value === "string" ? localDateTime(value) : ""}
          onChange={(e) =>
            onChange(e.target.value ? new Date(`${e.target.value}:00+08:00`).toISOString() : null)
          }
        />
      );
    case "time_range":
      return (
        <RangeInput
          id={id}
          field={field}
          value={isTimeRange(value ?? null) ? (value as TimeRange) : null}
          onChange={onChange}
          invalid={invalid}
        />
      );
    case "checkbox":
      return (
        <Checkbox
          {...common}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked === true)}
        />
      );
    case "select":
    case "status":
      return (
        <Select
          value={typeof value === "string" ? value : null}
          onValueChange={(v) => onChange(v as string)}
          items={Object.fromEntries((field.options ?? []).map((o) => [o.id, o.label]))}
        >
          <SelectTrigger {...common} className="w-full">
            <SelectValue placeholder={`Choose ${field.name.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {(field.options ?? []).map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      );
    case "relation":
      return (
        <RelationInput
          id={id}
          field={field}
          value={typeof value === "string" ? value : null}
          onChange={onChange}
          invalid={invalid}
        />
      );
    case "image":
      return (
        <ImageInput
          id={id}
          field={field}
          value={typeof value === "string" ? value : null}
          onChange={onChange}
        />
      );
    case "file":
      return (
        <FileInput
          id={id}
          field={field}
          value={typeof value === "string" ? value : null}
          onChange={onChange}
        />
      );
    case "signature":
      return (
        <SignatureInput
          id={id}
          field={field}
          invalid={invalid}
          value={typeof value === "string" ? value : null}
          onChange={onChange}
        />
      );
    case "email":
    case "phone":
    case "url":
      return (
        <Input
          {...common}
          type={field.type === "phone" ? "tel" : field.type}
          inputMode={field.type === "phone" ? "tel" : field.type === "email" ? "email" : "url"}
          autoComplete={field.type === "phone" ? "tel" : field.type === "email" ? "email" : "url"}
          placeholder={
            field.type === "email"
              ? "name@example.com"
              : field.type === "phone"
                ? "0917 555 0123"
                : "example.com"
          }
          value={String(value ?? "")}
          // A bare domain gets https:// when the field is left, so the link opens.
          onBlur={
            field.type === "url"
              ? (e) => {
                  const fixed = normalizeUrl(e.target.value);
                  if (fixed && fixed !== e.target.value) onChange(fixed);
                }
              : undefined
          }
          onChange={(e) => onChange(e.target.value)}
        />
      );
    default:
      return <Input {...common} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
  }
}

function RangeInput({
  id,
  field,
  value,
  onChange,
  invalid,
}: {
  id: string;
  field: Field;
  value: TimeRange | null;
  onChange: (value: FieldValue) => void;
  invalid?: boolean;
}) {
  if (field.range === "dates") {
    const start = value ? dateKey(value.start) : "";
    const end = value ? dateKey(value.end) : "";
    return (
      <div className="grid grid-cols-2 gap-2">
        <Input
          id={id}
          aria-label="From"
          aria-invalid={invalid || undefined}
          type="date"
          value={start}
          onChange={(e) =>
            onChange({ start: e.target.value, end: end && end >= e.target.value ? end : e.target.value })
          }
        />
        <Input
          aria-label="To"
          aria-invalid={invalid || undefined}
          type="date"
          value={end}
          min={start}
          onChange={(e) => onChange({ start: start || e.target.value, end: e.target.value })}
        />
      </div>
    );
  }
  const day = value ? dateKey(value.start) : "";
  const from = value ? timeOf(value.start) : "";
  const to = value ? timeOf(value.end) : "";
  const emit = (d: string, a: string, b: string) => {
    if (d && a && b) onChange({ start: at(d, a), end: at(d, b) });
  };
  return (
    <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2">
      <Input
        id={id}
        aria-label="Date"
        aria-invalid={invalid || undefined}
        type="date"
        value={day}
        onChange={(e) => emit(e.target.value, from || "09:00", to || "10:00")}
      />
      <Input
        aria-label="Starts"
        aria-invalid={invalid || undefined}
        type="time"
        step={900}
        value={from}
        onChange={(e) => emit(day, e.target.value, to)}
      />
      <Input
        aria-label="Ends"
        aria-invalid={invalid || undefined}
        type="time"
        step={900}
        value={to}
        onChange={(e) => emit(day, from, e.target.value)}
      />
    </div>
  );
}
