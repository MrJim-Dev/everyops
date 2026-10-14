import "server-only";
import { type RawBuilder, sql } from "kysely";
import { recordTitle } from "@/lib/blueprint/lookup";
import type { Blueprint, DataRecord, Entity, Field } from "@/lib/blueprint/types";
import { db } from "../db";
import { kindOf, MANILA } from "./digest";
import type { ToolSet } from "./gemini";

/**
 * The assistant's view of the data. Instead of every record (60k tokens for a busy canteen), Gemini gets a digest
 * (counts, totals, option tallies and date ranges per record type) plus the records on screen and small record types
 * in full, and looks up the rest with tools that run as SQL over workspace_record, scoped to the one workspace.
 */

/* ---------- Tools ---------- */

const filterSchema = {
  type: "array",
  description: "Conditions that must all hold",
  items: {
    type: "object",
    properties: {
      fieldId: { type: "string", description: 'A field id, or "createdAt"' },
      op: { type: "string", enum: ["eq", "neq", "contains", "gt", "gte", "lt", "lte", "empty", "not_empty"] },
      value: {
        type: "string",
        description:
          "Option id or label; a linked record's id or name; YYYY-MM-DD (Manila) for dates; digits for numbers; true/false",
      },
    },
    required: ["fieldId", "op"],
  },
};

const DECLARATIONS = [
  {
    name: "aggregate",
    description:
      "Exact count, sum, avg, min or max over one record type's records, optionally filtered and grouped by a field or by day/week/month of a date field. Use it for every number you report that isn't already in the data digest.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        metric: { type: "string", enum: ["count", "sum", "avg", "min", "max"] },
        fieldId: { type: "string", description: "The number or money field for sum, avg, min and max" },
        filters: filterSchema,
        groupBy: {
          type: "string",
          description: "A field id to group by (option, linked record, checkbox, text)",
        },
        dateFieldId: { type: "string", description: "Group by this date field's day, week or month instead" },
        bucket: { type: "string", enum: ["day", "week", "month"] },
      },
      required: ["entityId", "metric"],
    },
  },
  {
    name: "search_records",
    description:
      "Finds records of one type by text and filters, sorted, with the total that match. Linked records come with their names.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        entityId: { type: "string" },
        query: { type: "string", description: "Text to look for in any field" },
        filters: filterSchema,
        sortBy: { type: "string", description: 'A field id, or "createdAt" (default, newest first)' },
        sortDir: { type: "string", enum: ["asc", "desc"] },
        limit: { type: "integer", description: "Up to 50 (default 15)" },
      },
      required: ["entityId"],
    },
  },
  {
    name: "get_record",
    description:
      "One record by id with every field, plus the records linked to it (an order's lines, a customer's bookings).",
    parametersJsonSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
];

type Filter = { fieldId: string; op: string; value?: string };
type RecordRow = { id: string; entity_id: string; data: DataRecord["data"]; created_at: Date };

class ToolError extends Error {}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Read-only lookups over one workspace's records, for Gemini to call while it answers. */
export function recordTools(workspaceId: string, bp: Blueprint, onCall?: (text: string) => void): ToolSet {
  const entityOf = (id: unknown) => {
    const e = bp.entities.find((x) => x.id === id);
    if (!e)
      throw new ToolError(
        `Unknown record type "${String(id)}". Types: ${bp.entities.map((x) => x.id).join(", ")}`,
      );
    return e;
  };
  const fieldOf = (e: Entity, id: unknown): Field | "createdAt" => {
    if (id === "createdAt") return "createdAt";
    const f = e.fields.find((x) => x.id === id);
    if (!f)
      throw new ToolError(
        `${e.name} has no field "${String(id)}". Fields: ${e.fields.map((x) => x.id).join(", ")}`,
      );
    return f;
  };

  /** The SQL value of a field, typed so comparisons, sums and date buckets work. */
  const sqlValue = (f: Field | "createdAt"): RawBuilder<unknown> => {
    if (f === "createdAt") return sql`created_at`;
    switch (kindOf(f)) {
      case "number":
        return sql`(case when jsonb_typeof(data->${f.id}) = 'number' then (data->>${f.id})::numeric end)`;
      case "datetime":
        return sql`(case when data->>${f.id} ~ '^[0-9]{4}-' then (data->>${f.id})::timestamptz end)`;
      case "range":
        return sql`(case when data->${f.id}->>'start' ~ '^[0-9]{4}-' then (data->${f.id}->>'start')::timestamptz end)`;
      default:
        return sql`(data->>${f.id})`;
    }
  };

  async function linkedIds(target: Entity, value: string): Promise<string[]> {
    const { rows } = await sql<{ id: string }>`
      select id from workspace_record where workspace_id = ${workspaceId} and entity_id = ${target.id}
        and (id = ${value} or lower(data->>${target.primaryFieldId}) = lower(${value}))`.execute(db);
    if (rows.length) return rows.map((r) => r.id);
    const { rows: like } = await sql<{ id: string }>`
      select id from workspace_record where workspace_id = ${workspaceId} and entity_id = ${target.id}
        and data->>${target.primaryFieldId} ilike ${`%${value}%`} limit 20`.execute(db);
    return like.map((r) => r.id);
  }

  async function condition(e: Entity, raw: Filter): Promise<RawBuilder<unknown>> {
    const f = fieldOf(e, raw.fieldId);
    const v = String(raw.value ?? "").trim();
    const expr = sqlValue(f);
    if (raw.op === "empty") return f === "createdAt" ? sql`false` : sql`coalesce(data->>${f.id}, '') = ''`;
    if (raw.op === "not_empty")
      return f === "createdAt" ? sql`true` : sql`coalesce(data->>${f.id}, '') <> ''`;
    const kind = f === "createdAt" ? "datetime" : kindOf(f);
    const cmp = (left: RawBuilder<unknown>, right: RawBuilder<unknown>) => {
      switch (raw.op) {
        case "eq":
          return sql`${left} = ${right}`;
        case "neq":
          return sql`${left} is distinct from ${right}`;
        case "gt":
          return sql`${left} > ${right}`;
        case "gte":
          return sql`${left} >= ${right}`;
        case "lt":
          return sql`${left} < ${right}`;
        case "lte":
          return sql`${left} <= ${right}`;
        default:
          throw new ToolError(`"${raw.op}" doesn't work on ${raw.fieldId}`);
      }
    };
    if (kind === "number") {
      const n = Number(v.replace(/[₱,\s]/g, ""));
      if (!Number.isFinite(n)) throw new ToolError(`"${v}" isn't a number`);
      return cmp(expr, sql`${n}::numeric`);
    }
    if (kind === "datetime" || kind === "range") {
      if (DATE_ONLY.test(v)) {
        // A whole Manila day: "on" the day is from its midnight to the next.
        const start = sql`(${v}::date::timestamp at time zone ${MANILA})`;
        const end = sql`((${v}::date + 1)::timestamp at time zone ${MANILA})`;
        if (raw.op === "eq") return sql`(${expr} >= ${start} and ${expr} < ${end})`;
        if (raw.op === "neq") return sql`not (${expr} >= ${start} and ${expr} < ${end})`;
        if (raw.op === "lte") return sql`${expr} < ${end}`;
        if (raw.op === "gt") return sql`${expr} >= ${end}`;
        return cmp(expr, start);
      }
      if (Number.isNaN(Date.parse(v))) throw new ToolError(`"${v}" isn't a date`);
      return cmp(expr, sql`${new Date(v).toISOString()}::timestamptz`);
    }
    if (f === "createdAt") throw new ToolError("createdAt takes a date");
    if (kind === "option" || kind === "options") {
      const option = f.options?.find((o) => o.id === v || o.label.toLowerCase() === v.toLowerCase());
      if (!option && raw.op !== "contains")
        throw new ToolError(
          `"${v}" isn't an option of ${f.id}: ${(f.options ?? []).map((o) => o.id).join(", ")}`,
        );
      const id = option?.id ?? v;
      if (kind === "options") {
        const has = sql`coalesce(data->${f.id} ? ${id}, false)`;
        return raw.op === "neq" ? sql`not ${has}` : has;
      }
      return raw.op === "neq" ? sql`${expr} is distinct from ${id}` : sql`${expr} = ${id}`;
    }
    if (kind === "relation" && f.relation) {
      const target = entityOf(f.relation.entityId);
      const ids = await linkedIds(target, v);
      const any = sql`${expr} = any(${ids}::text[])`;
      return raw.op === "neq" ? sql`not coalesce(${any}, false)` : any;
    }
    if (kind === "checkbox") {
      const want = v === "true" || v === "yes";
      const is = sql`coalesce((data->>${f.id})::boolean, false) = ${want}`;
      return raw.op === "neq" ? sql`not ${is}` : is;
    }
    if (raw.op === "contains") return sql`${expr} ilike ${`%${v}%`}`;
    if (raw.op === "eq") return sql`lower(${expr}) = lower(${v})`;
    if (raw.op === "neq") return sql`lower(${expr}) is distinct from lower(${v})`;
    return cmp(expr, sql`${v}`);
  }

  async function where(e: Entity, filters: unknown, query?: unknown) {
    const parts: RawBuilder<unknown>[] = [sql`workspace_id = ${workspaceId}`, sql`entity_id = ${e.id}`];
    for (const f of Array.isArray(filters) ? (filters as Filter[]).slice(0, 10) : [])
      parts.push(await condition(e, f));
    const q = typeof query === "string" ? query.trim() : "";
    if (q) parts.push(sql`(data::text ilike ${`%${q}%`} or id = ${q})`);
    return sql.join(parts, sql` and `);
  }

  /** Names of linked records, so answers can say "Buko juice" instead of an id. */
  async function titles(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)].slice(0, 500);
    if (!unique.length) return new Map();
    const { rows } = await sql<{ id: string; entity_id: string; data: DataRecord["data"] }>`
      select id, entity_id, data from workspace_record where workspace_id = ${workspaceId} and id = any(${unique}::text[])`.execute(
      db,
    );
    return new Map(
      rows.map((r) => {
        const e = bp.entities.find((x) => x.id === r.entity_id);
        const rec = { id: r.id, entityId: r.entity_id, data: r.data, createdAt: "", updatedAt: "" };
        return [r.id, e ? recordTitle(e, rec) : r.id];
      }),
    );
  }

  async function present(e: Entity | undefined, rows: RecordRow[]) {
    const links: string[] = [];
    for (const r of rows) {
      const entity = e ?? bp.entities.find((x) => x.id === r.entity_id);
      for (const f of entity?.fields ?? [])
        if (kindOf(f) === "relation" && typeof r.data[f.id] === "string") links.push(r.data[f.id] as string);
    }
    const names = await titles(links);
    return rows.map((r) => {
      const entity = e ?? bp.entities.find((x) => x.id === r.entity_id);
      const linked: Record<string, string> = {};
      for (const f of entity?.fields ?? []) {
        const v = r.data[f.id];
        if (kindOf(f) === "relation" && typeof v === "string" && names.has(v))
          linked[f.id] = names.get(v) as string;
      }
      return {
        id: r.id,
        ...(e ? {} : { type: r.entity_id }),
        ...r.data,
        ...(Object.keys(linked).length ? { linkedNames: linked } : {}),
      };
    });
  }

  const run = async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    try {
      if (name === "aggregate") {
        const e = entityOf(args.entityId);
        const metric = String(args.metric ?? "count");
        let value: RawBuilder<unknown> = sql`count(*)`;
        if (metric !== "count") {
          const f = fieldOf(e, args.fieldId);
          if (f === "createdAt" || kindOf(f) !== "number")
            throw new ToolError(`${metric} needs a number or money field of ${e.name}`);
          const fn = { sum: sql`sum`, avg: sql`avg`, min: sql`min`, max: sql`max` }[metric];
          if (!fn) throw new ToolError(`Unknown metric "${metric}"`);
          value = sql`${fn}(${sqlValue(f)})`;
        }
        onCall?.(`Adding up ${e.pluralName.toLowerCase()}`);
        const cond = await where(e, args.filters);
        let key: RawBuilder<unknown> | null = null;
        let groupField: Field | null = null;
        if (args.dateFieldId) {
          const f = fieldOf(e, args.dateFieldId);
          const kind = f === "createdAt" ? "datetime" : kindOf(f);
          const bucket = args.bucket === "week" ? "week" : args.bucket === "month" ? "month" : "day";
          const local =
            kind === "date"
              ? sql`(${sqlValue(f)})::date::timestamp`
              : sql`(${sqlValue(f)} at time zone ${MANILA})`;
          key = sql`to_char(date_trunc(${bucket}, ${local}), ${bucket === "month" ? "YYYY-MM" : "YYYY-MM-DD"})`;
        } else if (args.groupBy) {
          const f = fieldOf(e, args.groupBy);
          if (f === "createdAt") throw new ToolError("Group createdAt with dateFieldId and bucket");
          groupField = f;
          key = sql`(data->>${f.id})`;
        }
        if (!key) {
          const { rows } = await sql<{ value: string | number | null; n: number }>`
            select ${value} as value, count(*)::int as n from workspace_record where ${cond}`.execute(db);
          const v = rows[0]?.value;
          return { value: v === null || v === undefined ? null : Number(v), records: rows[0]?.n ?? 0 };
        }
        const { rows } = await sql<{ key: string | null; value: string | number | null; n: number }>`
          select ${key} as key, ${value} as value, count(*)::int as n from workspace_record where ${cond}
          group by 1 order by ${args.dateFieldId ? sql`1` : sql`2 desc nulls last`} limit 60`.execute(db);
        const names =
          groupField && kindOf(groupField) === "relation"
            ? await titles(rows.map((r) => r.key).filter((k): k is string => !!k))
            : null;
        const label = (k: string | null) => {
          if (k === null) return "(none)";
          const option = groupField?.options?.find((o) => o.id === k);
          return names?.get(k) ?? option?.label ?? k;
        };
        return {
          groups: rows.map((r) => ({
            key: r.key,
            label: label(r.key),
            value: r.value === null ? null : Number(r.value),
            records: r.n,
          })),
        };
      }
      if (name === "search_records") {
        const e = entityOf(args.entityId);
        onCall?.(`Searching ${e.pluralName.toLowerCase()}`);
        const cond = await where(e, args.filters, args.query);
        const sortField = args.sortBy ? fieldOf(e, args.sortBy) : "createdAt";
        const dir = args.sortDir === "asc" ? sql`asc` : sql`desc`;
        const order =
          sortField === "createdAt"
            ? sql`created_at ${dir}, seq ${dir}`
            : sql`${sqlValue(sortField)} ${dir} nulls last, seq desc`;
        const limit = Math.min(Math.max(Number(args.limit) || 15, 1), 50);
        const { rows } = await sql<RecordRow & { total: number }>`
          select id, entity_id, data, created_at, count(*) over ()::int as total from workspace_record
          where ${cond} order by ${order} limit ${limit}`.execute(db);
        return { total: rows[0]?.total ?? 0, shown: rows.length, records: await present(e, rows) };
      }
      if (name === "get_record") {
        const id = String(args.id ?? "");
        const { rows } = await sql<RecordRow>`
          select id, entity_id, data, created_at from workspace_record where workspace_id = ${workspaceId} and id = ${id}`.execute(
          db,
        );
        const row = rows[0];
        if (!row) throw new ToolError(`No record "${id}"`);
        const e = entityOf(row.entity_id);
        onCall?.(
          `Opening ${recordTitle(e, { id: row.id, entityId: e.id, data: row.data, createdAt: "", updatedAt: "" })}`,
        );
        // Records that link to this one (an order's lines), through any relation field that points at its type.
        const links = bp.entities.flatMap((x) =>
          x.fields.filter((f) => f.relation?.entityId === e.id).map((f) => ({ entity: x, field: f })),
        );
        const linked: Record<string, unknown> = {};
        for (const l of links.slice(0, 6)) {
          const { rows: kids } = await sql<RecordRow & { total: number }>`
            select id, entity_id, data, created_at, count(*) over ()::int as total from workspace_record
            where workspace_id = ${workspaceId} and entity_id = ${l.entity.id} and data->>${l.field.id} = ${id}
            order by seq limit 30`.execute(db);
          if (kids.length)
            linked[`${l.entity.id} (by ${l.field.id})`] = {
              total: kids[0].total,
              records: await present(l.entity, kids),
            };
        }
        return { record: (await present(e, [row]))[0], type: e.id, linked };
      }
      return { error: `Unknown tool "${name}"` };
    } catch (error) {
      if (error instanceof ToolError) return { error: error.message };
      console.warn(JSON.stringify({ event: "assistant_tool_failed", name, message: String(error) }));
      return { error: "That lookup failed. Try a simpler one." };
    }
  };

  return { declarations: DECLARATIONS, run, maxRounds: 4 };
}
