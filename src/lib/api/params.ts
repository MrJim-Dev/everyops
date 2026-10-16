/** Query and header parsing for the public REST API (/api/v1); pure so it can be tested. */

/** The rev to check: "rev" in the body or query, else an If-Match header (a number, quotes allowed). */
export function revOf(request: Request, body?: Record<string, unknown> | null): number | undefined {
  const raw =
    body?.rev ??
    new URL(request.url).searchParams.get("rev") ??
    request.headers.get("if-match")?.replaceAll('"', "");
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

const OPS = new Set(["eq", "neq", "contains", "gt", "gte", "lt", "lte", "empty", "not_empty"]);

/**
 * Filters from the query string: filter=FIELD:OP:VALUE, repeatable (VALUE may contain colons; empty and not_empty
 * take none). Answers the filters or an error message.
 */
export function parseFilters(
  params: URLSearchParams,
): { fieldId: string; op: string; value?: string }[] | string {
  const out: { fieldId: string; op: string; value?: string }[] = [];
  for (const raw of params.getAll("filter")) {
    const [fieldId, op, ...rest] = raw.split(":");
    if (!fieldId || !op || !OPS.has(op))
      return `Bad filter "${raw}". Use FIELD:OP:VALUE with OP one of ${[...OPS].join(", ")}.`;
    out.push(rest.length ? { fieldId, op, value: rest.join(":") } : { fieldId, op });
  }
  return out.slice(0, 20);
}

/** Opaque page cursors: the offset of the next page. */
export const cursor = {
  encode: (offset: number) => Buffer.from(JSON.stringify({ o: offset })).toString("base64url"),
  decode: (value: string | null): number | null => {
    if (!value) return 0;
    try {
      const o = JSON.parse(Buffer.from(value, "base64url").toString()).o;
      return Number.isInteger(o) && o >= 0 ? o : null;
    } catch {
      return null;
    }
  },
};
