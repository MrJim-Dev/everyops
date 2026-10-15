import type { DataEvidence } from "@/lib/assistant/evidence";
import type { Blueprint } from "@/lib/blueprint/types";

export type LookupCall = { name: string; args: Record<string, unknown>; result: unknown };
export type LookupResult = {
  status: "not_needed" | DataEvidence["status"];
  text: string;
  evidence?: DataEvidence;
};

const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function incomplete(result: Record<string, unknown>): boolean {
  if (result.truncated === true) return true;
  if (
    typeof result.total === "number" &&
    Array.isArray(result.records) &&
    result.total > result.records.length
  )
    return true;
  return Object.values(object(result.linked)).some((v) => incomplete(object(v)));
}

function count(result: Record<string, unknown>): number | undefined {
  if (typeof result.total === "number") return result.total;
  if (typeof result.records === "number") return result.records;
  if (Array.isArray(result.groups))
    return result.groups.reduce((n, g) => n + Number(object(g).records ?? 0), 0);
  if (result.record) return 1;
  return undefined;
}

const OPERATORS: Record<string, string> = {
  eq: "is",
  neq: "is not",
  contains: "contains",
  gte: "from",
  gt: "after",
  lte: "through",
  lt: "before",
  empty: "is empty",
  not_empty: "is not empty",
};

function describe(call: LookupCall, bp: Blueprint): DataEvidence["queries"][number] {
  const entity = bp.entities.find((e) => e.id === call.args.entityId || e.id === object(call.result).type);
  const fieldName = (id: unknown) => entity?.fields.find((f) => f.id === id)?.name ?? "Field";
  const metric = call.args.metric;
  const label =
    call.name === "aggregate"
      ? `${entity?.pluralName ?? "Records"} · ${metric === "count" ? "count" : `${metric} of ${fieldName(call.args.fieldId)}`}`
      : call.name === "get_record"
        ? `${entity?.name ?? "Record"} and linked records`
        : (entity?.pluralName ?? "Records");
  const filters = (Array.isArray(call.args.filters) ? call.args.filters : []).map((v) => {
    const filter = object(v);
    const field = entity?.fields.find((f) => f.id === filter.fieldId);
    const raw = String(filter.value ?? "");
    const value = field?.relation
      ? "selected record"
      : (field?.options?.find((o) => o.id === raw)?.label ?? raw);
    return `${filter.fieldId === "createdAt" ? "Created" : (field?.name ?? "Field")} ${OPERATORS[String(filter.op)] ?? "matches"} ${value}`.trim();
  });
  if (call.args.query) filters.push(`Search: ${String(call.args.query)}`);
  if (call.args.groupBy) filters.push(`Grouped by ${fieldName(call.args.groupBy)}`);
  if (call.args.dateFieldId)
    filters.push(`${fieldName(call.args.dateFieldId)} by ${String(call.args.bucket ?? "day")}`);
  const result = object(call.result);
  const matched = count(result);
  return {
    label,
    scope: filters.join(" · ") || (call.name === "get_record" ? "Selected record" : "All records"),
    ...(matched === undefined ? {} : { matched }),
    ...(typeof result.shown === "number" ? { shown: result.shown } : {}),
  };
}

/** Keep complete JSON entries, never cut a result in the middle of a record or a number. */
export function lookupResult(
  bp: Blueprint,
  calls: LookupCall[],
  ok: boolean,
  maxChars = 14_000,
): LookupResult {
  // Parallel hedges may repeat a lookup. A successful retry of that exact call replaces its earlier error.
  const unique = new Map<string, LookupCall>();
  for (const call of calls) {
    const key = JSON.stringify([call.name, call.args]);
    if (!unique.has(key) || !object(call.result).error) unique.set(key, call);
  }
  const all = [...unique.values()];
  if (!all.length && ok)
    return {
      status: "not_needed",
      text: "No database lookup was needed. Use only facts explicitly present in the digest.",
    };
  let truncated = all.some((c) => incomplete(object(c.result)));
  const lines: string[] = [];
  let size = 0;
  for (const call of all) {
    const line = JSON.stringify(call);
    if (size + line.length > maxChars) {
      truncated = true;
      continue;
    }
    lines.push(line);
    size += line.length + 1;
  }
  const status: DataEvidence["status"] =
    !ok || all.some((c) => !!object(c.result).error)
      ? "failed"
      : truncated
        ? "truncated"
        : all.length && all.every((c) => count(object(c.result)) === 0)
          ? "no_matches"
          : "success";
  return {
    status,
    text: `Lookup status: ${status}. Dates and date filters use Asia/Manila.\n${lines.join("\n")}`,
    evidence: {
      status,
      checkedAt: new Date().toISOString(),
      queries: all.filter((c) => !object(c.result).error).map((c) => describe(c, bp)),
    },
  };
}

/** A failed/partial retrieval must never become a confident answer or a broad record edit. */
export function lookupProblem(result: LookupResult): string | null {
  if (result.status === "failed")
    return "I couldn't verify the records for this request, so I haven't calculated an answer or prepared any changes. Please try again.";
  if (result.status === "truncated")
    return "There are more results than I could check completely. Please narrow the date range or name the records you want, so I can give you a complete answer or change plan.";
  return null;
}
