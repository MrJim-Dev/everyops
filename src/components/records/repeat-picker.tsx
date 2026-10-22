"use client";

import { useId } from "react";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { useWorkspace } from "@/components/workspace/workspace-context";
import { recordTitle } from "@/lib/blueprint/lookup";
import type { Entity } from "@/lib/blueprint/types";
import { resourceLabel } from "@/lib/engine/availability";
import { type Every, MAX_REPEATS, type Repeat, type SeriesItem } from "@/lib/engine/recurrence";
import { formatDate } from "@/lib/format";
import { addDays } from "@/lib/time";

export type RepeatChoice = {
  rule: "none" | "day" | "week" | "week2" | "month";
  ends: "count" | "until";
  count: number;
  until: string;
};

export const NO_REPEAT: RepeatChoice = { rule: "none", ends: "count", count: 8, until: "" };

const RULES: Record<RepeatChoice["rule"], string> = {
  none: "Does not repeat",
  day: "Every day",
  week: "Every week",
  week2: "Every 2 weeks",
  month: "Every month",
};

/** The engine's repeat for a choice, or null when it doesn't repeat. */
export function toRepeat(choice: RepeatChoice): Repeat | null {
  if (choice.rule === "none") return null;
  const every: Every = choice.rule === "week2" ? "week" : choice.rule;
  const interval = choice.rule === "week2" ? 2 : 1;
  return choice.ends === "until" && choice.until
    ? { every, interval, until: choice.until }
    : { every, interval, count: Math.max(2, Math.min(MAX_REPEATS, Math.floor(choice.count) || 2)) };
}

/** "Repeat" in a new record's form: how often, until when, and what that makes, clashes included. */
export function RepeatPicker({
  entity,
  value,
  onChange,
  firstDay,
  plan,
}: {
  entity: Entity;
  value: RepeatChoice;
  onChange: (next: RepeatChoice) => void;
  /** The day the record falls on; without one there is nothing to repeat yet. */
  firstDay: string | null;
  plan: SeriesItem[];
}) {
  const { blueprint, records } = useWorkspace();
  const id = useId();
  const made = plan.filter((i) => !i.clash);
  const clashes = plan.filter((i) => i.clash);
  const noun = (n: number) => (n === 1 ? entity.name.toLowerCase() : entity.pluralName.toLowerCase());
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field className="w-auto">
          <FieldLabel htmlFor={`${id}-rule`}>Repeat</FieldLabel>
          <NativeSelect
            id={`${id}-rule`}
            value={value.rule}
            disabled={!firstDay}
            onChange={(e) => onChange({ ...value, rule: e.target.value as RepeatChoice["rule"] })}
          >
            {Object.entries(RULES).map(([rule, label]) => (
              <NativeSelectOption key={rule} value={rule}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        {value.rule !== "none" ? (
          <>
            <Field className="w-auto">
              <FieldLabel htmlFor={`${id}-ends`}>Ends</FieldLabel>
              <NativeSelect
                id={`${id}-ends`}
                value={value.ends}
                onChange={(e) => {
                  const ends = e.target.value as RepeatChoice["ends"];
                  onChange({
                    ...value,
                    ends,
                    until: value.until || (firstDay ? addDays(firstDay, 8 * 7) : ""),
                  });
                }}
              >
                <NativeSelectOption value="count">After</NativeSelectOption>
                <NativeSelectOption value="until">On</NativeSelectOption>
              </NativeSelect>
            </Field>
            {value.ends === "count" ? (
              <Field className="w-auto">
                <FieldLabel htmlFor={`${id}-count`}>Times</FieldLabel>
                <Input
                  id={`${id}-count`}
                  type="number"
                  min={2}
                  max={MAX_REPEATS}
                  className="w-20"
                  value={value.count}
                  onChange={(e) => onChange({ ...value, count: Number(e.target.value) })}
                />
              </Field>
            ) : (
              <Field className="w-auto">
                <FieldLabel htmlFor={`${id}-until`}>Last day</FieldLabel>
                <Input
                  id={`${id}-until`}
                  type="date"
                  min={firstDay ?? undefined}
                  className="w-40"
                  value={value.until}
                  onChange={(e) => onChange({ ...value, until: e.target.value })}
                />
              </Field>
            )}
          </>
        ) : null}
      </div>
      {!firstDay ? (
        <p className="text-[12.5px] text-muted-foreground">
          Pick a date first to repeat this {entity.name.toLowerCase()}.
        </p>
      ) : value.rule !== "none" && plan.length ? (
        <div className="flex flex-col gap-1.5 text-[12.5px]" aria-live="polite">
          <p>
            <span className="font-medium">
              {made.length} {noun(made.length)}
            </span>
            <span className="text-muted-foreground">
              {" "}
              · {formatDate(plan[0].day, { withYear: true })} to{" "}
              {formatDate(plan[plan.length - 1].day, { withYear: true })}
            </span>
          </p>
          {clashes.length ? (
            <ul className="flex flex-col gap-0.5 text-amber-700 dark:text-amber-400">
              {clashes.slice(0, 5).map((c) => (
                <li key={c.day}>
                  Skips {formatDate(c.day)}: {resourceLabel(blueprint, entity, c.data, records) || "it"} is
                  taken
                  {c.clash ? ` (${recordTitle(entity, c.clash)})` : ""}
                </li>
              ))}
              {clashes.length > 5 ? <li>and {clashes.length - 5} more</li> : null}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
