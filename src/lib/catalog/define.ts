import type { DataRecord, Field, FieldOption, RecordData, Tone } from "@/lib/blueprint/types";

/** Small, typed helpers that keep blueprint definitions short and readable. */
type Extra = Partial<Omit<Field, "id" | "name" | "type">>;

const make =
  (type: Field["type"]) =>
  (id: string, name: string, extra: Extra = {}): Field => ({ id, name, type, ...extra });

export const f = {
  text: make("text"),
  longText: make("long_text"),
  number: make("number"),
  money: make("money"),
  percent: make("percent"),
  rating: make("rating"),
  duration: make("duration"),
  date: make("date"),
  datetime: make("datetime"),
  timeRange: make("time_range"),
  checkbox: make("checkbox"),
  email: make("email"),
  phone: make("phone"),
  url: make("url"),
  file: make("file"),
  person: make("person"),
  select: (id: string, name: string, options: [string, string, Tone?][], extra: Extra = {}): Field => ({
    id,
    name,
    type: "select",
    options: toOptions(options),
    ...extra,
  }),
  status: (id: string, name: string, options: [string, string, Tone?][], extra: Extra = {}): Field => ({
    id,
    name,
    type: "status",
    options: toOptions(options),
    ...extra,
  }),
  relation: (id: string, name: string, entityId: string, extra: Extra = {}): Field => ({
    id,
    name,
    type: "relation",
    relation: { entityId },
    ...extra,
  }),
  formula: (
    id: string,
    name: string,
    expr: string,
    resultType: NonNullable<Field["formula"]>["resultType"],
    freezeWhen?: string,
  ): Field => ({ id, name, type: "formula", formula: { expr, resultType, freezeWhen } }),
  rollup: (id: string, name: string, spec: NonNullable<Field["rollup"]>): Field => ({
    id,
    name,
    type: "rollup",
    rollup: spec,
  }),
};

function toOptions(options: [string, string, Tone?][]): FieldOption[] {
  return options.map(([id, label, tone]) => ({ id, label, tone: tone ?? "neutral" }));
}

/** Deterministic pseudo-random numbers so sample data is stable per day. */
export function seeded(seed: number) {
  let a = seed;
  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => Math.floor(next() * (max - min + 1)) + min,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (p: number) => next() < p,
  };
}

export function recordFactory(now: Date) {
  const stamp = now.toISOString();
  return (entityId: string, id: string, data: RecordData): DataRecord => ({
    id,
    entityId,
    data,
    createdAt: stamp,
    updatedAt: stamp,
  });
}
